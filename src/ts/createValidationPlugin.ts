import {
  IPluginState,
  VALIDATION_PLUGIN_ACTION,
  validationPluginReducer,
  applyNewDirtiedRanges,
  validationRequestForDirtyRanges,
  createInitialState
} from "./state";
import {
  DECORATION_ATTRIBUTE_HEIGHT_MARKER_ID,
  DECORATION_ATTRIBUTE_ID
} from "./utils/decoration";
import { EditorView } from "prosemirror-view";
import { Plugin, Transaction } from "prosemirror-state";
import {
  expandRangesToParentBlockNode,
  mapAndMergeRanges,
  mapRanges
} from "./utils/range";
import { getReplaceStepRangesFromTransaction } from "./utils/prosemirror";
import { getStateHoverInfoFromEvent } from "./utils/dom";
import { IRange } from "./interfaces/IValidation";
import { Node } from "prosemirror-model";
import Store from "./store";
import { indicateHoverCommand } from "./commands";

/**
 * @module createValidationPlugin
 */

export type ExpandRanges = (ranges: IRange[], doc: Node<any>) => IRange[];

interface IPluginOptions {
  /**
   * A function that receives ranges that have been dirtied since the
   * last validation request, and returns the new ranges to validate. The
   * default implementation expands the dirtied ranges to cover the parent
   * block node.
   */
  expandRanges?: ExpandRanges;

  /**
   * The throttle duration for validation requests, in ms.
   */
  throttleInMs?: number;

  /**
   * The maximum throttle duration.
   */
  maxThrottle?: number;
}

/**
 * Creates a document validator plugin, responsible for issuing validation
 * requests when the document is changed, decorating the document when they
 * are returned, and applying suggestions.
 *
 * @param {IPluginOptions} options The plugin options object.
 * @returns {{plugin: Plugin, commands: ICommands}}
 */
const createValidatorPlugin = (options: IPluginOptions = {}) => {
  const {
    expandRanges = expandRangesToParentBlockNode,
    throttleInMs = 2000,
    maxThrottle = 8000
  } = options;
  let localView: EditorView;

  // Set up our store, which we'll use to notify consumer code of state updates.
  const store = new Store();

  /**
   * Request a validation for the currently pending ranges.
   */
  const requestValidation = () => {
    const pluginState: IPluginState = plugin.getState(localView.state);
    // If there's already a validation in flight, defer validation
    // for another throttle tick
    if (pluginState.validationInFlight) {
      return scheduleValidation();
    }
    localView.dispatch(
      localView.state.tr.setMeta(
        VALIDATION_PLUGIN_ACTION,
        validationRequestForDirtyRanges(expandRanges)
      )
    );
  };
  const scheduleValidation = () =>
    setTimeout(
      requestValidation,
      plugin.getState(localView.state).currentThrottle
    );

  const plugin: Plugin = new Plugin({
    state: {
      init: (_, { doc }) => createInitialState(doc, throttleInMs, maxThrottle),
      apply(tr: Transaction, state: IPluginState): IPluginState {
        // There are certain things we need to do every time a transaction
        // is dispatched, and the logic for that doesn't belong in the reducer.
        const newState = {
          ...state,
          // Map our decorations, dirtied ranges and validations through the new transaction.
          decorations: state.decorations.map(tr.mapping, tr.doc),
          dirtiedRanges: mapAndMergeRanges(tr, state.dirtiedRanges),
          currentValidations: mapRanges(tr, state.currentValidations),
          // Keep the transaction history up to date ... to a point! If we get a
          // validation result older than this history, we can discard it and ask
          // for another.
          trHistory:
            state.trHistory.length > 25
              ? state.trHistory.slice(1).concat(tr)
              : state.trHistory.concat(tr)
        };
        // Apply our reducer.
        return validationPluginReducer(
          tr,
          newState,
          tr.getMeta(VALIDATION_PLUGIN_ACTION)
        );
      }
    },

    /**
     * We use appendTransaction to handle side effects and dispatch actions
     * in response to state transitions.
     */
    appendTransaction(trs: Transaction[], _, newState) {
      const pluginState: IPluginState = plugin.getState(newState);
      const tr = newState.tr;

      // Check for dirted ranges and update the state accordingly.
      const newDirtiedRanges = trs.reduce(
        (acc, range) => acc.concat(getReplaceStepRangesFromTransaction(range)),
        [] as IRange[]
      );
      if (newDirtiedRanges.length) {
        // If we haven't yet scheduled a validation request, issue a delayed
        // request to the validation service, and mark the state as pending
        // validation.
        if (!pluginState.validationPending) {
          scheduleValidation();
        }
        return tr.setMeta(
          VALIDATION_PLUGIN_ACTION,
          applyNewDirtiedRanges(newDirtiedRanges)
        );
      }
    },
    props: {
      decorations: state => {
        return plugin.getState(state).decorations;
      },
      handleDOMEvents: {
        mouseover: (view: EditorView, event: MouseEvent) => {
          if (!event.target || !(event.target instanceof HTMLElement)) {
            return false;
          }
          const target = event.target;
          const targetAttr = target.getAttribute(DECORATION_ATTRIBUTE_ID);
          const newValidationId = targetAttr ? targetAttr : undefined;
          if (newValidationId === plugin.getState(view.state).hoverId) {
            return false;
          }

          // Get our height marker, which tells us the height of a single line
          // for the given validation.
          const heightMarker = document.querySelector(
            `[${DECORATION_ATTRIBUTE_HEIGHT_MARKER_ID}="${newValidationId}"]`
          );
          if (
            newValidationId &&
            (!heightMarker || !(heightMarker instanceof HTMLElement))
          ) {
            // tslint:disable-next-line no-console
            console.warn(
              `No height marker found for id ${newValidationId}, or the returned marker is not an HTML element. This is odd - a height marker should be present. It's probably a bug.`
            );
            return false;
          }

          indicateHoverCommand(
            newValidationId,
            getStateHoverInfoFromEvent(event, view.dom, heightMarker)
          )(localView.state, localView.dispatch)

          return false;
        }
      }
    },
    view(view) {
      localView = view;
      return {
        // Update our store with the new state, which can then notify its subscribers.
        update: (_, prevState) => store.notify(plugin.getState(view.state), plugin.getState(prevState))
      };
    }
  });

  return {
    plugin,
    store,
    getState: plugin.getState
  };
};

export default createValidatorPlugin;

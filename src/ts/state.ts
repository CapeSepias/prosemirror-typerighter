import { Transaction } from "prosemirror-state";
import { DecorationSet, Decoration } from "prosemirror-view";
import { IRange } from "./interfaces/IValidation";
import {
  IValidationError,
  IValidationInput,
  IValidationOutput,
  IValidationResponse
} from "./interfaces/IValidation";
import {
  createDebugDecorationFromRange,
  DECORATION_DIRTY,
  DECORATION_INFLIGHT,
  getNewDecorationsForCurrentValidations as createNewDecorationsForCurrentValidations,
  removeDecorationsFromRanges,
  createDecorationForValidationRange,
  DECORATION_VALIDATION
} from "./utils/decoration";
import {
  mergeRanges,
  validationInputToRange,
  mapAndMergeRanges,
  mapRanges,
  getCurrentValidationsFromValidationResponse,
  findOverlappingRangeIndex,
  removeOverlappingRanges
} from "./utils/range";
import { ExpandRanges } from "./createValidationPlugin";
import { createValidationInputsForDocument } from "./utils/prosemirror";
import { Node } from "prosemirror-model";
import { Mapping } from "prosemirror-transform";
import difference from "lodash/difference";
import without from "lodash/without";

/**
 * Information about the span element the user is hovering over.
 */
export interface IStateHoverInfo {
  // The offsetLeft property of the element relative to the document container.
  // If the span covers multiple lines, this will be the point that the span
  // starts on the line - for the left position of the bounding rectangle see
  // `left`.
  offsetLeft: number;
  // The offsetTop property of the element relative to the document container.
  offsetTop: number;
  // The left property from the element's bounding rectangle.
  left: number;
  // The top property from the element's bounding rectangle.
  top: number;
  // The height of the element.
  height: number;
  // The x coordinate of the mouse position relative to the element
  mouseOffsetX: number;
  // The y coordinate of the mouse position relative to the element
  mouseOffsetY: number;
  // The height the element would have if it occupied a single line.
  // Useful when determining where to put a tooltip if the user
  // is hovering over a span that covers several lines.
  heightOfSingleLine: number;
}

export interface IValidationInFlight {
  mapping: Mapping;
  validationInput: IValidationInput;
  id: string;
}

export interface IPluginState {
  // Is the plugin in debug mode? Debug mode adds marks to show dirtied
  // and expanded ranges.
  debug: boolean;
  // The initial throttle duration for pending validation requests.
  initialThrottle: number;
  // The current throttle duration, which increases during backof.
  currentThrottle: number;
  // The maximum possible throttle duration.
  maxThrottle: number;
  // The current decorations the plugin is applying to the document.
  decorations: DecorationSet;
  // The current validation outputs for the document.
  currentValidations: IValidationOutput[];
  // The current ranges that are marked as dirty, that is, have been
  // changed since the last validation pass.
  dirtiedRanges: IRange[];
  // The currently selected validation;
  selectedValidation: string | undefined;
  // The id of the validation the user is currently hovering over.
  hoverId: string | undefined;
  // See StateHoverInfo.
  hoverInfo: IStateHoverInfo | undefined;
  // The history of transactions accrued since the last validation.
  // These are mapped through to apply validations applied against
  // a preview document state to the current document state.
  trHistory: Transaction[];
  // Is a validation pending - that is, have ranges been dirtied but
  // not yet been expanded and sent for validation?
  validationPending: boolean;
  // Is a validation currently in flight - that is, has a validation
  // been sent to the validation service and we're awaiting its
  // return?
  validationsInFlight: IValidationInFlight[];
  // The current error status.
  error: string | undefined;
}

// The transaction meta key that namespaces our actions.
const VALIDATION_PLUGIN_ACTION = "VALIDATION_PLUGIN_ACTION";

/**
 * Action types.
 */

const VALIDATION_REQUEST_FOR_DIRTY_RANGES = "VAlIDATION_REQUEST_START";
const VALIDATION_REQUEST_FOR_DOCUMENT = "VALIDATION_REQUEST_FOR_DOCUMENT";
const VALIDATION_REQUEST_SUCCESS = "VALIDATION_REQUEST_SUCCESS";
const VALIDATION_REQUEST_ERROR = "VALIDATION_REQUEST_ERROR";
const NEW_HOVER_ID = "NEW_HOVER_ID";
const SELECT_VALIDATION = "SELECT_VALIDATION";
const APPLY_NEW_DIRTY_RANGES = "HANDLE_NEW_DIRTY_RANGES";
const SET_DEBUG_STATE = "SET_DEBUG_STATE";

/**
 * Action creators.
 */

export const validationRequestForDirtyRanges = (
  expandRanges: ExpandRanges
) => ({
  type: VALIDATION_REQUEST_FOR_DIRTY_RANGES as typeof VALIDATION_REQUEST_FOR_DIRTY_RANGES,
  payload: { expandRanges }
});
type ActionValidationRequestForDirtyRanges = ReturnType<
  typeof validationRequestForDirtyRanges
>;

export const validationRequestForDocument = () => ({
  type: VALIDATION_REQUEST_FOR_DOCUMENT as typeof VALIDATION_REQUEST_FOR_DOCUMENT
});
type ActionValidationRequestForDocument = ReturnType<
  typeof validationRequestForDocument
>;

export const validationRequestSuccess = (response: IValidationResponse) => ({
  type: VALIDATION_REQUEST_SUCCESS as typeof VALIDATION_REQUEST_SUCCESS,
  payload: { response }
});
type ActionValidationResponseReceived = ReturnType<
  typeof validationRequestSuccess
>;

export const validationRequestError = (validationError: IValidationError) => ({
  type: VALIDATION_REQUEST_ERROR as typeof VALIDATION_REQUEST_ERROR,
  payload: { validationError }
});
type ActionValidationRequestError = ReturnType<typeof validationRequestError>;

export const newHoverIdReceived = (
  hoverId: string | undefined,
  hoverInfo?: IStateHoverInfo | undefined
) => ({
  type: NEW_HOVER_ID as typeof NEW_HOVER_ID,
  payload: { hoverId, hoverInfo }
});
type ActionNewHoverIdReceived = ReturnType<typeof newHoverIdReceived>;

export const applyNewDirtiedRanges = (ranges: IRange[]) => ({
  type: APPLY_NEW_DIRTY_RANGES as typeof APPLY_NEW_DIRTY_RANGES,
  payload: { ranges }
});
type ActionHandleNewDirtyRanges = ReturnType<typeof applyNewDirtiedRanges>;

export const selectValidation = (validationId: string) => ({
  type: SELECT_VALIDATION as typeof SELECT_VALIDATION,
  payload: { validationId }
});
type ActionSelectValidation = ReturnType<typeof selectValidation>;

export const setDebugState = (debug: boolean) => ({
  type: SET_DEBUG_STATE as typeof SET_DEBUG_STATE,
  payload: { debug }
});
type ActionSetDebugState = ReturnType<typeof setDebugState>;

type Action =
  | ActionNewHoverIdReceived
  | ActionValidationResponseReceived
  | ActionValidationRequestForDirtyRanges
  | ActionValidationRequestForDocument
  | ActionValidationRequestError
  | ActionSelectValidation
  | ActionHandleNewDirtyRanges
  | ActionSetDebugState;

/**
 * Initial state.
 */
export const createInitialState = (
  doc: Node,
  throttleInMs: number,
  maxThrottle: number
): IPluginState => ({
  debug: false,
  currentThrottle: throttleInMs,
  initialThrottle: throttleInMs,
  maxThrottle,
  decorations: DecorationSet.create(doc, []),
  dirtiedRanges: [],
  currentValidations: [],
  selectedValidation: undefined,
  hoverId: undefined,
  hoverInfo: undefined,
  trHistory: [],
  validationsInFlight: [],
  validationPending: false,
  error: undefined
});

/**
 * Selectors.
 */

export const selectValidationById = (
  state: IPluginState,
  id: string
): IValidationOutput | undefined =>
  state.currentValidations.find(validation => validation.id === id);

export const selectValidationInFlightById = (
  state: IPluginState,
  id: string
): IValidationInFlight | undefined =>
  state.validationsInFlight.find(_ => _.id === id);

export const selectNewValidationInFlight = (
  state: IPluginState,
  oldState: IPluginState
) => difference(state.validationsInFlight, oldState.validationsInFlight);

export const selectSuggestionAndRange = (
  state: IPluginState,
  validationId: string,
  suggestionIndex: number
) => {
  const output = selectValidationById(state, validationId);
  if (!output) {
    return null;
  }
  const suggestion = output.suggestions && output.suggestions[suggestionIndex];
  if (!suggestion) {
    return null;
  }
  return {
    from: output.from,
    to: output.to,
    suggestion
  };
};

/**
 * Reducer.
 */

const validationPluginReducer = (
  tr: Transaction,
  incomingState: IPluginState,
  action?: Action
): IPluginState => {
  // There are certain things we need to do every time a transaction is dispatched.
  const state = {
    ...incomingState,
    // Map our decorations, dirtied ranges and validations through the new transaction.
    decorations: incomingState.decorations.map(tr.mapping, tr.doc),
    dirtiedRanges: mapAndMergeRanges(incomingState.dirtiedRanges, tr.mapping),
    currentValidations: mapRanges(incomingState.currentValidations, tr.mapping),
    validationsInFlight: incomingState.validationsInFlight.map(_ => {
      // We create a new mapping here to preserve state immutability, as
      // appendMapping mutates an existing mapping.
      const mapping = new Mapping();
      mapping.appendMapping(_.mapping);
      mapping.appendMapping(tr.mapping);
      return {
        ..._,
        mapping
      };
    })
  };

  if (!action) {
    return state;
  }

  switch (action.type) {
    case NEW_HOVER_ID:
      return handleNewHoverId(tr, state, action);
    case VALIDATION_REQUEST_FOR_DIRTY_RANGES:
      return handleValidationRequestForDirtyRanges(tr, state, action);
    case VALIDATION_REQUEST_FOR_DOCUMENT:
      return handleValidationRequestForDocument(tr, state, action);
    case VALIDATION_REQUEST_SUCCESS:
      return handleValidationRequestSuccess(tr, state, action);
    case VALIDATION_REQUEST_ERROR:
      return handleValidationRequestError(tr, state, action);
    case SELECT_VALIDATION:
      return handleSelectValidation(tr, state, action);
    case APPLY_NEW_DIRTY_RANGES:
      return handleNewDirtyRanges(tr, state, action);
    case SET_DEBUG_STATE:
      return handleSetDebugState(tr, state, action);
    default:
      return state;
  }
};

/**
 * Action handlers.
 */

type ActionHandler<ActionType> = (
  _: Transaction,
  state: IPluginState,
  action: ActionType
) => IPluginState;

/**
 * Handle the selection of a hover id.
 */
const handleSelectValidation: ActionHandler<ActionSelectValidation> = (
  _,
  state,
  action
): IPluginState => {
  return {
    ...state,
    selectedValidation: action.payload.validationId
  };
};

/**
 * Handle the receipt of a new hover id.
 */
const handleNewHoverId: ActionHandler<ActionNewHoverIdReceived> = (
  tr,
  state,
  action
): IPluginState => {
  let decorations = state.decorations;
  const incomingHoverId = action.payload.hoverId;
  const currentHoverId = state.hoverId;

  // The current hover decorations are no longer valid -- remove them.
  if (currentHoverId) {
    decorations = decorations.remove(
      state.decorations.find(
        undefined,
        undefined,
        spec =>
          spec.id === currentHoverId && spec.type === DECORATION_VALIDATION
      )
    );
  }

  // Add the new decorations for the current and incoming validations.
  decorations = [
    { id: incomingHoverId, isHovering: true },
    { id: currentHoverId, isHovering: false }
  ].reduce((acc, hoverData) => {
    const output = selectValidationById(state, hoverData.id || "");
    if (!output) {
      return acc;
    }
    return decorations.add(
      tr.doc,
      createDecorationForValidationRange(output, hoverData.isHovering, false)
    );
  }, decorations);

  return {
    ...state,
    decorations,
    hoverId: action.payload.hoverId,
    hoverInfo: action.payload.hoverInfo
  };
};

const handleNewDirtyRanges: ActionHandler<ActionHandleNewDirtyRanges> = (
  tr,
  state,
  { payload: { ranges: dirtiedRanges } }
) => {
  // Map our dirtied ranges through the current transaction, and append
  // any new ranges it has dirtied.
  let newDecorations = state.debug
    ? state.decorations.add(
        tr.doc,
        dirtiedRanges.map(range => createDebugDecorationFromRange(range))
      )
    : state.decorations;

  // Remove any validations and associated decorations
  // touched by the dirtied ranges from the doc
  newDecorations = removeDecorationsFromRanges(newDecorations, dirtiedRanges);
  const currentValidations = state.currentValidations.filter(
    output => findOverlappingRangeIndex(output, dirtiedRanges) === -1
  );

  return {
    ...state,
    validationPending: true,
    currentValidations,
    decorations: newDecorations,
    dirtiedRanges: state.dirtiedRanges.concat(dirtiedRanges)
  };
};

/**
 * Handle a validation request for the current set of dirty ranges.
 */
const handleValidationRequestForDirtyRanges: ActionHandler<
  ActionValidationRequestForDirtyRanges
> = (tr, state, { payload: { expandRanges } }) => {
  const ranges = expandRanges(state.dirtiedRanges, tr.doc);
  const validationInputs: IValidationInput[] = ranges.map(range => ({
    inputString: tr.doc.textBetween(range.from, range.to),
    ...range
  }));
  return handleValidationRequestStart(validationInputs)(tr, state);
};

/**
 * Handle a validation request for the entire document.
 */
const handleValidationRequestForDocument: ActionHandler<
  ActionValidationRequestForDocument
> = (tr, state) => {
  return handleValidationRequestStart(
    createValidationInputsForDocument(tr.doc)
  )(tr, state);
};

/**
 * Handle a validation request for a given set of validation inputs.
 */
const handleValidationRequestStart = (validationInputs: IValidationInput[]) => (
  tr: Transaction,
  state: IPluginState
) => {
  // Replace any debug decorations, if they exist.
  const decorations = state.debug
    ? removeDecorationsFromRanges(state.decorations, validationInputs, [
        DECORATION_DIRTY
      ]).add(
        tr.doc,
        validationInputs.map(range =>
          createDebugDecorationFromRange(range, false)
        )
      )
    : state.decorations;

  return {
    ...state,
    decorations,
    // We reset the dirty ranges, as they've been expanded and sent for validation.
    dirtiedRanges: [],
    validationPending: false,
    validationsInFlight: state.validationsInFlight.concat(
      validationInputs.map(validationInput => ({
        id: tr.time.toString(),
        mapping: new Mapping(),
        validationInput
      }))
    )
  };
};

/**
 * Handle a validation response, decorating the document with
 * any validations we've received.
 */
const handleValidationRequestSuccess: ActionHandler<
  ActionValidationResponseReceived
> = (tr, state, action) => {
  const response = action.payload.response;
  if (!response) {
    return state;
  }

  const validationInFlight = selectValidationInFlightById(state, response.id);
  if (!validationInFlight) {
    return state;
  }

  let currentValidations = getCurrentValidationsFromValidationResponse(
    validationInFlight.validationInput,
    response.validationOutputs,
    state.currentValidations,
    validationInFlight.mapping
  );
  // We don't apply incoming validations to ranges that have
  // been dirtied since they were requested.
  currentValidations = removeOverlappingRanges(
    currentValidations,
    state.dirtiedRanges
  );

  // Create our decorations for the newly current validations.
  const decorations = createNewDecorationsForCurrentValidations(
    currentValidations,
    state.decorations,
    tr.doc
  );

  // Ditch any decorations marking inflight validations
  const decsToRemove = state.debug
    ? state.decorations.find(
        undefined,
        undefined,
        _ => _.type === DECORATION_INFLIGHT
      )
    : [];

  return {
    ...state,
    validationsInFlight: without(state.validationsInFlight, validationInFlight),
    currentValidations,
    decorations: decorations.remove(decsToRemove)
  };
};

/**
 * Handle a validation request error.
 */
const handleValidationRequestError: ActionHandler<
  ActionValidationRequestError
> = (tr, state, action) => {
  const validationInFlight = selectValidationInFlightById(
    state,
    action.payload.validationError.id
  );
  const dirtiedRanges = validationInFlight
    ? mapRanges(
        [
          validationInputToRange(action.payload.validationError.validationInput)
        ],
        validationInFlight.mapping
      )
    : [];
  const decsToRemove = dirtiedRanges.reduce(
    (acc, range) =>
      acc.concat(
        state.decorations.find(
          range.from,
          range.to,
          _ => _.type === DECORATION_INFLIGHT
        )
      ),
    [] as Decoration[]
  );

  // When we get errors, we map the ranges due to be validated back
  // through the document and add them to the dirtied ranges to be
  // validated on the next pass.
  let decorations = state.decorations.remove(decsToRemove);

  if (dirtiedRanges.length) {
    decorations = decorations.add(
      tr.doc,
      dirtiedRanges.map(range => createDebugDecorationFromRange(range))
    );
  }

  // @todo - add backoff if appropriate (429)
  return {
    ...state,
    dirtiedRanges: dirtiedRanges.length
      ? mergeRanges(state.dirtiedRanges.concat(dirtiedRanges))
      : state.dirtiedRanges,
    decorations,
    validationsInFlight: validationInFlight
      ? without(state.validationsInFlight, validationInFlight)
      : state.validationsInFlight,
    error: action.payload.validationError.message
  };
};

const handleSetDebugState: ActionHandler<ActionSetDebugState> = (
  _,
  state,
  { payload: { debug } }
) => {
  return {
    ...state,
    debug
  };
};

export {
  VALIDATION_PLUGIN_ACTION,
  VALIDATION_REQUEST_FOR_DIRTY_RANGES,
  VALIDATION_REQUEST_SUCCESS,
  VALIDATION_REQUEST_ERROR,
  NEW_HOVER_ID,
  Action,
  validationPluginReducer
};

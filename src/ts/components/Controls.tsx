import React, { Component } from "react";
import { v4 } from "uuid";
import IconButton from "@material-ui/core/IconButton";
import { Close } from "@material-ui/icons";

import Store, { STORE_EVENT_NEW_STATE } from "../state/store";
import { IPluginState } from "../state/reducer";
import { IMatch, ICategory } from "../interfaces/IMatch";
import {
  selectHasGeneralError,
  selectHasAuthError,
  selectRequestsInProgress
} from "../state/selectors";

interface IProps {
  store: Store<IMatch>;
  setDebugState: (debug: boolean) => void;
  setRequestOnDocModified: (r: boolean) => void;
  requestMatchesForDocument: (requestId: string, categoryIds: string[]) => void;
  fetchCategories: () => Promise<ICategory[]>;
  getCurrentCategories: () => ICategory[];
  addCategory: (id: string) => void;
  removeCategory: (id: string) => void;
  feedbackHref?: string;
  onToggleActiveState: () => void;
}

interface IState {
  pluginState: IPluginState<IMatch> | undefined;
  allCategories: ICategory[];
  currentCategories: ICategory[];
  isLoadingCategories: boolean;
}

/**
 * A sidebar to display current matches and allow users to apply suggestions.
 */
class Controls extends Component<IProps, IState> {
  public state = {
    allCategories: [],
    currentCategories: [],
    isLoadingCategories: false,
    pluginState: undefined
  } as IState;
  public componentWillMount() {
    this.props.store.on(STORE_EVENT_NEW_STATE, this.handleNotify);
    this.setState({ pluginState: this.props.store.getState() });
    this.initCategories();
  }

  public render() {
    const handleCheckDocumentButtonClick = (): void => {
      if (!this.state.pluginState?.config.isActive) {
        this.props.onToggleActiveState();
      }
      this.requestMatchesForDocument();
    };

    const headerContainerClasses = this.state.pluginState?.config.isActive
      ? "Sidebar__header-container"
      : "Sidebar__header-container Sidebar__header-container--is-closed";

    const renderErrorMessage = () => {
      const pluginState = this.state.pluginState;

      if (!pluginState) {
        return;
      }

      const hasAuthError = selectHasAuthError(pluginState);
      const hasGeneralError = selectHasGeneralError(pluginState);
      const hasErrors: boolean = hasAuthError || hasGeneralError;

      let errorMessage: string = "";
      if (hasAuthError) {
        errorMessage = "Authentication error - please refresh the page. ";
      }
      if (hasGeneralError && !hasAuthError) {
        errorMessage =
          "Error fetching matches. Please try checking the document again. ";
      }
      if (hasErrors) {
        return (
          <div className="Controls__error-message">
            {errorMessage}
            {this.props.feedbackHref && (
              <span>
                If the error persists, please{" "}
                <a href={this.getErrorFeedbackLink()} target="_blank">
                  contact us
                </a>
                .
              </span>
            )}
          </div>
        );
      }
    };

    return (
      <>
        <div className={headerContainerClasses}>
          <div className="Sidebar__header">
            <button
              type="button"
              className="Button"
              onClick={handleCheckDocumentButtonClick}
              disabled={
                this.state.pluginState &&
                selectRequestsInProgress(this.state.pluginState)
              }
            >
              Check document
            </button>
            {this.state.pluginState?.config.isActive && (
              <IconButton
                size="small"
                aria-label="close Typerighter"
                onClick={this.props.onToggleActiveState}
                disabled={
                  this.state.pluginState &&
                  selectRequestsInProgress(this.state.pluginState)
                }
              >
                <Close />
              </IconButton>
            )}
          </div>
        </div>
        {renderErrorMessage()}
      </>
    );
  }
  private handleNotify = (state: IPluginState<IMatch>) => {
    this.setState({ pluginState: state });
  };

  private initCategories = async () => {
    const allCategories = await this.fetchCategories();
    if (!allCategories) {
      return;
    }
    this.setState({
      currentCategories: allCategories
    });
    allCategories.forEach(category => this.props.addCategory(category.id));
  };

  private fetchCategories = async () => {
    this.setState({ isLoadingCategories: true });
    try {
      const allCategories = await this.props.fetchCategories();
      this.setState({
        allCategories,
        isLoadingCategories: false
      });
      return allCategories;
    } catch (e) {
      this.setState({
        isLoadingCategories: false
      });
    }
  };

  private requestMatchesForDocument = () => {
    this.props.requestMatchesForDocument(
      v4(),
      this.props.getCurrentCategories().map(_ => _.id)
    );
  };

  private getErrorFeedbackLink = () => {
    const errorLmit = 10;
    const data = {
      url: document.location.href,
      errors: this.state.pluginState?.requestErrors?.slice(0, errorLmit)
    };
    const encodedData = encodeURIComponent(JSON.stringify(data, undefined, 2));
    return this.props.feedbackHref + encodedData;
  };
}

export default Controls;

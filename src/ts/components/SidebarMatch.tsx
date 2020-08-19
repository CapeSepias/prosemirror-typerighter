import compact from "lodash/compact";

import React, { Component } from "react";

import { IMatch } from "../interfaces/IMatch";
import {
  IMatchColours,
  getColourForMatch,
  maybeGetDecorationElement
} from "../utils/decoration";
import titleCase from "lodash/startCase";
import { ApplySuggestionOptions } from "../commands";
import SuggestionList from "./SuggestionList";
import { getHtmlFromMarkdown } from "../utils/dom";

interface IProps {
  match: IMatch;
  matchColours: IMatchColours;
  applySuggestions: (suggestions: ApplySuggestionOptions) => void;
  selectMatch: (matchId: string) => void;
  indicateHighlight: (blockId: string, _?: any) => void;
  stopHighlight: () => void;
  selectedMatch: string | undefined;
  editorScrollElement: Element;
  getScrollOffset: () => number;
}

interface IState {
  isOpen: boolean;
}

/**
 * Display information for a single match
 */
class SidebarMatch extends Component<IProps, IState> {
  public state = {
    isOpen: false
  };

  public render() {
    const { match, matchColours, applySuggestions, selectedMatch } = this.props;
    const color = getColourForMatch(match, matchColours, false).borderColour;
    const hasSuggestions = !!match.suggestions && !!match.suggestions.length;
    const suggestions = compact([
      match.replacement,
      ...(match.suggestions || [])
    ]);
    return (
      <div
        className={`SidebarMatch__container ${
          selectedMatch === match.matchId
            ? "SidebarMatch__container--is-selected"
            : ""
        }`}
        style={{ borderLeft: `2px solid ${color}` }}
        onMouseEnter={this.handleMouseEnter}
        onMouseLeave={this.handleMouseLeave}
        onClick={this.scrollToRange}
        title="Click to scroll to this match"
      >
        <div
          className={"SidebarMatch__header"}
          onClick={hasSuggestions ? this.toggleOpen : undefined}
        >
          <div className="SidebarMatch__header-label">
            <div>
              <div className="SidebarMatch__header-match-text">
                {match.matchedText}
              </div>
              <div
                className="SidebarMatch__header-description"
                dangerouslySetInnerHTML={{
                  __html: getHtmlFromMarkdown(match.message)
                }}
              ></div>
            </div>
            <div className="SidebarMatch__header-meta">
              <div className="SidebarMatch__header-category">
                {titleCase(match.category.name)}
              </div>
              {hasSuggestions && (
                <div className="SidebarMatch__header-toggle-status">
                  {this.state.isOpen ? "-" : "+"}
                </div>
              )}
            </div>
          </div>
        </div>
        {this.state.isOpen && (
          <div className="SidebarMatch__content">
            {suggestions.length && (
              <div className="SidebarMatch__suggestion-list">
                <SuggestionList
                  applySuggestions={applySuggestions}
                  matchId={match.matchId}
                  matchedText={match.matchedText}
                  suggestions={suggestions}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  private toggleOpen = () => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  private scrollToRange = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.preventDefault();
    e.stopPropagation();

    const { editorScrollElement, match, getScrollOffset } = this.props;
    if (!editorScrollElement) {
      return;
    }

    const decorationElement = maybeGetDecorationElement(match.matchId);

    if (decorationElement) {
      const scrollToYCoord = decorationElement.offsetTop - getScrollOffset();
      editorScrollElement.scrollTo({
        top: scrollToYCoord,
        behavior: "smooth"
      });
    }
  };

  private handleMouseEnter = () => {
    this.props.indicateHighlight(this.props.match.matchId);
  };

  private handleMouseLeave = () => {
    this.props.stopHighlight();
  };
}

export default SidebarMatch;

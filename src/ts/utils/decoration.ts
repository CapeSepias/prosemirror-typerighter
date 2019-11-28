import flatten from "lodash/flatten";
import { Node } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import { IRange, IMatch } from "../interfaces/IMatch";

// Our decoration types.
export const DECORATION_MATCH = "DECORATION_MATCH";
export const DECORATION_MATCH_IS_CORRECT = "DECORATION_MATCH_IS_CORRECT";
export const DECORATION_MATCH_IS_SELECTED = "DECORATION_MATCH_IS_HOVERING";
export const DECORATION_MATCH_HEIGHT_MARKER = "DECORATION_MATCH_HEIGHT_MARKER";
export const DECORATION_DIRTY = "DECORATION_DIRTY";
export const DECORATION_INFLIGHT = "DECORATION_INFLIGHT";

export const DecorationClassMap = {
  [DECORATION_DIRTY]: "MatchDebugDirty",
  [DECORATION_INFLIGHT]: "MatchDebugInflight",
  [DECORATION_MATCH]: "MatchDecoration",
  [DECORATION_MATCH_HEIGHT_MARKER]: "MatchDecoration__height-marker",
  [DECORATION_MATCH_IS_SELECTED]: "MatchDecoration--is-selected",
  [DECORATION_MATCH_IS_CORRECT]: "MatchDecoration--is-correct"
};

export const DECORATION_ATTRIBUTE_ID = "data-match-id";
export const DECORATION_ATTRIBUTE_HEIGHT_MARKER_ID = "data-height-marker-id";
export const DECORATION_ATTRIBUTE_IS_CORRECT_ID = "data-is-correct-id";

export const createDebugDecorationFromRange = (range: IRange, dirty = true) => {
  const type = dirty ? DECORATION_DIRTY : DECORATION_INFLIGHT;
  return Decoration.inline(
    range.from,
    range.to + 1,
    {
      class: DecorationClassMap[type]
    },
    {
      type
    } as any
  );
};

/**
 * Remove decorations from the given ranges. If decorations are found,
 * expand the search range to include their ranges, too.
 */
export const removeDecorationsFromRanges = (
  decorationSet: DecorationSet,
  ranges: IRange[],
  types = [DECORATION_MATCH, DECORATION_MATCH_HEIGHT_MARKER]
) =>
  ranges.reduce((acc, range) => {
    const predicate = (spec: { [key: string]: any }) =>
      types.indexOf(spec.type) !== -1;
    const decorations = decorationSet.find(range.from, range.to, predicate);
    if (!decorations.length) {
      return acc;
    }
    // Expand the range out to the range of the found decorations.
    const decorationsToRemove = flatten(
      decorations
        .map(decoration =>
          decorationSet.find(decoration.from, decoration.to, predicate)
        )
        .filter(_ => !!_)
    );
    return acc.remove(decorationsToRemove);
  }, decorationSet);

/**
 * Given a matcher response and the current decoration set,
 * returns a new decoration set containing the new matches.
 */
export const getNewDecorationsForCurrentMatches = (
  outputs: IMatch[],
  decorationSet: DecorationSet,
  doc: Node
) => {
  const decorationsToAdd = createDecorationsForMatches(outputs);

  return decorationSet.add(doc, decorationsToAdd);
};

/**
 * Create a height marker element. Used to determine the height
 * of a single line of inline content, which is useful when we're
 * calculating where to place tooltips as the user hovers over multi-
 * line spans.
 */
const createHeightMarkerElement = (id: string) => {
  const element = document.createElement("span");
  element.setAttribute(DECORATION_ATTRIBUTE_HEIGHT_MARKER_ID, id);
  element.className = DecorationClassMap[DECORATION_MATCH_HEIGHT_MARKER];
  return element;
};

/**
 * Create an 'isCorrect' element. Displays a little tick to let
 * users know that this range has been marked as correct.
 */
const createIsCorrectElement = (id: string) => {
  const element = document.createElement("span");
  element.setAttribute(DECORATION_ATTRIBUTE_IS_CORRECT_ID, id);
  element.className = DecorationClassMap[DECORATION_MATCH_IS_CORRECT];
  return element;
};

/**
 * Create decorations for the given match.
 */
export const createDecorationsForMatch = (
  match: IMatch,
  isSelected = false,
  addHeightMarker = true
) => {
  const className = isSelected
    ? `${DecorationClassMap[DECORATION_MATCH]} ${
        DecorationClassMap[DECORATION_MATCH_IS_SELECTED]
      }`
    : DecorationClassMap[DECORATION_MATCH];

  const opacity = isSelected ? "30" : "07";
  const style = `background-color: #${
    match.category.colour
  }${opacity}; border-bottom: 2px solid #${match.category.colour}`;

  const decorations = [
    Decoration.inline(
      match.from,
      match.to,
      {
        class: className,
        style,
        [DECORATION_ATTRIBUTE_ID]: match.matchId
      } as any,
      {
        type: DECORATION_MATCH,
        id: match.matchId,
        categoryId: match.category.id,
        inclusiveStart: false,
        inclusiveEnd: false
      } as any
    )
  ];

  if (addHeightMarker) {
    decorations.push(
      Decoration.widget(match.from, createHeightMarkerElement(match.matchId), {
        type: DECORATION_MATCH_HEIGHT_MARKER,
        id: match.matchId,
        categoryId: match.category.id
      } as any)
    );
  }

  if (match.markAsCorrect) {
    decorations.push(
      Decoration.widget(match.to, createIsCorrectElement(match.matchId), {
        type: DECORATION_MATCH_IS_CORRECT,
        id: match.matchId,
        categoryId: match.category.id
      } as any)
    );
  }

  return decorations;
};

export const createDecorationsForMatches = (matches: IMatch[]) =>
  flatten(matches.map(_ => createDecorationsForMatch(_)));

export const findSingleDecoration = (
  decorationSet: DecorationSet,
  predicate: (spec: any) => boolean
): Decoration | undefined => {
  const decorations = decorationSet.find(undefined, undefined, predicate);
  if (!decorations[0]) {
    return undefined;
  }
  return decorations[0];
};

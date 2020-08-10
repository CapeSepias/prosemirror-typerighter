import { Schema } from "prosemirror-model";
import { marks, nodes } from "prosemirror-schema-basic";
import { builders } from "prosemirror-test-builder";
import {
  EditorView,
  DecorationSet,
  InlineDecorationSpec,
  Decoration
} from "prosemirror-view";

const schema = new Schema({
  nodes,
  marks
});

const build = builders(schema, {
  p: {
    markType: "paragraph"
  }
});

export const createDoc = build.doc;
export const p = build.p;

/**
 * We cannot compare document decorations to plugin decorations, as the
 * .ProseMirror-widget class is applied – but we can compare their specs.
 * We compare sets here because the order is arbitrary.
 */
export const getDecorationSpecsFromDoc = (
  view: EditorView
): Set<InlineDecorationSpec> =>
  getDecorationSpecsFromSet(view.someProp("decorations", f => f(view.state)));

export const getDecorationSpecsFromSet = (
  set: DecorationSet
): Set<InlineDecorationSpec> => new Set(set.find().map(_ => _.spec));

export const getDecorationSpecs = (
  decorations: Decoration[]
): Set<InlineDecorationSpec> => new Set(decorations.map(_ => _.spec));

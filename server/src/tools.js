import { z } from "zod";
import { listPresets } from "./presets.js";

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorResult(err) {
  return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
}

// "ae_set_layer_property" -> "setLayerProperty" — mirrors the naming
// convention used consistently across every tool/op pair in this file.
function toolNameToOp(toolName) {
  return toolName
    .replace(/^ae_/, "")
    .split("_")
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

export function registerTools(server, bridge) {
  const tool = (name, description, shape, handler) => {
    server.registerTool(
      name,
      { description, inputSchema: shape },
      async (args) => {
        try {
          const result = await handler(args);
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  };

  tool(
    "ae_ping",
    "Check whether the After Effects bridge is reachable. Call this first if unsure the connection is up.",
    {},
    () => bridge.call("ping")
  );

  tool(
    "ae_list_compositions",
    "List all compositions in the currently open After Effects project, with their project-panel index.",
    {},
    () => bridge.call("listCompositions")
  );

  tool(
    "ae_create_composition",
    "Create a new composition in After Effects.",
    {
      name: z.string().describe("Composition name"),
      width: z.number().int().positive().default(1920),
      height: z.number().int().positive().default(1080),
      frameRate: z.number().positive().default(30),
      duration: z.number().positive().default(10),
    },
    (args) => bridge.call("createComposition", args)
  );

  tool(
    "ae_duplicate_composition",
    "Duplicate a composition.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional().describe("Name for the duplicate; defaults to AE's own naming"),
    },
    (args) => bridge.call("duplicateComposition", args)
  );

  tool(
    "ae_set_composition_settings",
    "Change settings on an existing composition (resolution, duration, frame rate, background color, work area).",
    {
      compIndex: z.number().int().positive(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      duration: z.number().positive().optional(),
      frameRate: z.number().positive().optional(),
      pixelAspect: z.number().positive().optional(),
      bgColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe("RGB 0-1"),
      workAreaStart: z.number().optional(),
      workAreaDuration: z.number().optional(),
    },
    (args) => bridge.call("setCompositionSettings", args)
  );

  tool(
    "ae_open_composition",
    "Open/activate a composition in the After Effects viewer, so it's visible on screen.",
    { compIndex: z.number().int().positive() },
    (args) => bridge.call("openComposition", args)
  );

  tool(
    "ae_create_shape_layer",
    "Create an empty shape layer. Follow with ae_add_shape_group, ae_add_shape_primitive, and " +
      "ae_add_shape_fill/ae_add_shape_stroke to build actual content.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
    },
    (args) => bridge.call("createShapeLayer", args)
  );

  tool(
    "ae_add_shape_group",
    "Add a vector group (a container for one shape's path + fill + stroke) to a shape layer's contents.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      name: z.string().optional(),
    },
    (args) => bridge.call("addShapeGroup", args)
  );

  tool(
    "ae_add_shape_primitive",
    "Add geometry to a shape group: a rectangle, ellipse, or custom path. Verified working for rect " +
      "(fill/stroke/roundness) against a live AE instance; ellipse and path share the same code path.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      groupIndex: z.number().int().positive().describe("From ae_add_shape_group"),
      shapeType: z.enum(["rect", "ellipse", "path"]),
      size: z.tuple([z.number(), z.number()]).optional().describe("rect/ellipse: [width, height]"),
      position: z.tuple([z.number(), z.number()]).optional().describe(
        "rect/ellipse: [x, y] offset from the shape layer's own Transform Position (which defaults to " +
        "comp-center for a new shape layer) — NOT an absolute canvas coordinate. Use [0,0] to center it " +
        "on the layer's transform, then move the layer itself (ae_set_layer_property on 'Position') to place it."
      ),
      roundness: z.number().optional().describe("rect only: corner roundness"),
      vertices: z.array(z.tuple([z.number(), z.number()])).optional().describe("path only: point list"),
      inTangents: z.array(z.tuple([z.number(), z.number()])).optional().describe("path only: bezier in-tangents, same length as vertices"),
      outTangents: z.array(z.tuple([z.number(), z.number()])).optional().describe("path only: bezier out-tangents, same length as vertices"),
      closed: z.boolean().optional().describe("path only: whether the path is closed"),
    },
    (args) => bridge.call("addShapePrimitive", args)
  );

  tool(
    "ae_add_shape_fill",
    "Add a fill to a shape group.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      groupIndex: z.number().int().positive(),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe("RGB 0-1"),
      opacity: z.number().min(0).max(100).optional(),
    },
    (args) => bridge.call("addShapeFill", args)
  );

  tool(
    "ae_add_shape_stroke",
    "Add a stroke to a shape group.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      groupIndex: z.number().int().positive(),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe("RGB 0-1"),
      width: z.number().positive().optional(),
      opacity: z.number().min(0).max(100).optional(),
    },
    (args) => bridge.call("addShapeStroke", args)
  );

  tool(
    "ae_add_shape_path_operation",
    "Add a path operation to a shape group: Trim/Merge/Repeater/Offset/Pucker & Bloat/Round Corners/" +
      "Roughen/Wiggle Transform/Zig Zag. matchNames: 'ADBE Vector Filter - Trim', 'ADBE Vector Filter - " +
      "Merge', 'ADBE Vector Filter - Repeater', 'ADBE Vector Filter - Offset', 'ADBE Vector Filter - PB', " +
      "'ADBE Vector Filter - RC', 'ADBE Vector Filter - Roughen', 'ADBE Vector Filter - Wiggler', " +
      "'ADBE Vector Filter - Zigzag'. NOTE: 'ADBE Vector Filter - RC' (Round Corners) is confirmed to add " +
      "with the correct Radius value but produce no visible effect, on both a Rectangle primitive and a " +
      "custom path — for a Rectangle, set 'roundness' on ae_add_shape_primitive instead. Other path " +
      "operations (Trim, Merge, Repeater, etc.) have matchNames confirmed against official docs but are " +
      "otherwise unverified.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      groupIndex: z.number().int().positive(),
      matchName: z.string(),
      settings: z.record(z.any()).optional().describe("Optional map of property name -> initial value"),
    },
    (args) => bridge.call("addShapePathOperation", args)
  );

  tool(
    "ae_set_shape_group_transform",
    "Set a property on the shape GROUP's own transform (Position/Scale/Rotation/Opacity/Anchor Point of " +
      "the whole group) — distinct from an individual shape primitive's local position.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      groupIndex: z.number().int().positive(),
      propertyName: z.string(),
      value: z.any(),
    },
    (args) => bridge.call("setShapeGroupTransform", args)
  );

  tool(
    "ae_add_mask",
    "Add a mask to a layer with a given path. Verified working against a live AE instance.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      name: z.string().optional(),
      vertices: z.array(z.tuple([z.number(), z.number()])).min(2),
      inTangents: z.array(z.tuple([z.number(), z.number()])).optional(),
      outTangents: z.array(z.tuple([z.number(), z.number()])).optional(),
      closed: z.boolean().optional().describe("Default true"),
      maskMode: z.string().optional().describe("AE MaskMode enum name, e.g. 'ADD', 'SUBTRACT', 'INTERSECT'"),
    },
    (args) => bridge.call("addMask", args)
  );

  tool(
    "ae_list_masks",
    "List masks on a layer.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("listMasks", args)
  );

  tool(
    "ae_set_mask_property",
    "Set a property on an existing mask, e.g. propertyName 'Mask Feather', 'Mask Opacity', 'Mask Expansion', 'Mask Path'.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      maskIndex: z.number().int().positive(),
      propertyName: z.string(),
      value: z.any(),
    },
    (args) => bridge.call("setMaskProperty", args)
  );

  tool(
    "ae_add_text_animator",
    "Add a per-character text animator (with a default range selector) to a text layer — the AE feature " +
      "behind kinetic type. Follow with ae_add_animator_property to add what actually animates.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      name: z.string().optional(),
      startPercent: z.number().min(0).max(100).optional().describe("Selector range start, default 0"),
      endPercent: z.number().min(0).max(100).optional().describe("Selector range end, default 100"),
    },
    (args) => bridge.call("addTextAnimator", args)
  );

  tool(
    "ae_add_animator_property",
    "Add an animated property to a text animator — this is what actually changes per character. Common " +
      "matchNames: 'ADBE Text Position 3D', 'ADBE Text Scale 3D', 'ADBE Text Rotation', 'ADBE Text Opacity', " +
      "'ADBE Text Fill Color', 'ADBE Text Tracking Amount'.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      animatorIndex: z.number().int().positive().describe("From ae_add_text_animator"),
      matchName: z.string(),
      value: z.any().optional(),
    },
    (args) => bridge.call("addAnimatorProperty", args)
  );

  tool(
    "ae_set_animator_selector_range",
    "Adjust a text animator's range selector (which characters are affected).",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      animatorIndex: z.number().int().positive(),
      selectorIndex: z.number().int().positive().optional().describe("Default 1 (the first/default selector)"),
      startPercent: z.number().min(0).max(100).optional(),
      endPercent: z.number().min(0).max(100).optional(),
      offsetPercent: z.number().optional(),
    },
    (args) => bridge.call("setAnimatorSelectorRange", args)
  );

  tool(
    "ae_create_solid",
    "Create a solid-color layer in a composition — the simplest way to get a layer to work with " +
      "(apply effects, animate, etc).",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe("RGB 0-1, defaults to white"),
      width: z.number().positive().optional().describe("Defaults to comp width"),
      height: z.number().positive().optional().describe("Defaults to comp height"),
      duration: z.number().positive().optional().describe("Defaults to comp duration"),
    },
    (args) => bridge.call("createSolid", args)
  );

  tool(
    "ae_create_text",
    "Create a text layer in a composition.",
    {
      compIndex: z.number().int().positive(),
      text: z.string(),
      font: z.string().optional().describe("Postscript font name, e.g. 'Arial-BoldMT'"),
      fontSize: z.number().positive().optional(),
      fillColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe("RGB 0-1"),
      position: z.tuple([z.number(), z.number()]).optional().describe("[x, y] in comp pixel coordinates"),
    },
    (args) => bridge.call("createText", args)
  );

  tool(
    "ae_create_null",
    "Create a null object layer — invisible, commonly used as a parent/rig control.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
      duration: z.number().positive().optional().describe("Defaults to comp duration"),
    },
    (args) => bridge.call("createNull", args)
  );

  tool(
    "ae_create_camera",
    "Create a camera layer in a composition.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
      centerPoint: z.tuple([z.number(), z.number()]).optional().describe("Point of interest [x,y]; defaults to comp center"),
    },
    (args) => bridge.call("createCamera", args)
  );

  tool(
    "ae_create_light",
    "Create a light layer in a composition.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
      centerPoint: z.tuple([z.number(), z.number()]).optional().describe("Position [x,y]; defaults to comp center"),
      lightType: z.enum(["PARALLEL", "SPOT", "POINT", "AMBIENT", "ENVIRONMENT"]).optional(),
    },
    (args) => bridge.call("createLight", args)
  );

  tool(
    "ae_create_adjustment_layer",
    "Create an adjustment layer — effects applied to it affect every layer below it in the stack.",
    {
      compIndex: z.number().int().positive(),
      name: z.string().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      duration: z.number().positive().optional(),
    },
    (args) => bridge.call("createAdjustmentLayer", args)
  );

  tool(
    "ae_precompose",
    "Wrap a set of layers into a new nested composition (precompose). Returns the new comp's project-panel " +
      "index — re-check with ae_list_compositions rather than assuming it.",
    {
      compIndex: z.number().int().positive(),
      layerIndices: z.array(z.number().int().positive()).min(1).describe("1-based indices of layers to precompose"),
      name: z.string().optional(),
      moveAllAttributes: z.boolean().optional().describe("Default true: moves the layers' own effects/transforms into the new comp"),
    },
    (args) => bridge.call("precompose", args)
  );

  tool(
    "ae_duplicate_layer",
    "Duplicate a layer. Returns the new duplicate's index — re-check with ae_list_layers rather than " +
      "assuming it, since duplicating shifts every layer below it down by one.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("duplicateLayer", args)
  );

  tool(
    "ae_delete_layer",
    "Delete a layer from a composition.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("deleteLayer", args)
  );

  tool(
    "ae_move_layer",
    "Reorder a layer within its composition's stack. Provide exactly one of toTop, toBottom, " +
      "aboveLayerIndex, belowLayerIndex.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      toTop: z.boolean().optional(),
      toBottom: z.boolean().optional(),
      aboveLayerIndex: z.number().int().positive().optional(),
      belowLayerIndex: z.number().int().positive().optional(),
    },
    (args) => bridge.call("moveLayer", args)
  );

  tool(
    "ae_set_layer_parent",
    "Parent a layer to another layer, or clear its parent by omitting parentLayerIndex.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      parentLayerIndex: z.number().int().positive().optional(),
    },
    (args) => bridge.call("setLayerParent", args)
  );

  tool(
    "ae_set_layer_timing",
    "Set a layer's start time, in point, and/or out point (seconds, on the composition's timeline).",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      startTime: z.number().optional(),
      inPoint: z.number().optional(),
      outPoint: z.number().optional(),
    },
    (args) => bridge.call("setLayerTiming", args)
  );

  tool(
    "ae_split_layer",
    "Split a layer into two at a given time (defaults to the comp's current time). Returns both " +
      "resulting layers' indices.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      timeInSeconds: z.number().optional(),
    },
    (args) => bridge.call("splitLayer", args)
  );

  tool(
    "ae_set_layer_flags",
    "Set layer flags/toggles: 3D, blend mode, track matte type, solo, shy, locked, enabled (visibility), " +
      "label color index, audio enabled. Only fields provided are changed.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      threeDLayer: z.boolean().optional(),
      blendMode: z.string().optional().describe("AE BlendingMode enum name, e.g. 'MULTIPLY', 'SCREEN', 'ADD'"),
      trackMatteType: z.string().optional().describe("AE TrackMatteType enum name, e.g. 'ALPHA', 'LUMA'"),
      solo: z.boolean().optional(),
      shy: z.boolean().optional(),
      locked: z.boolean().optional(),
      enabled: z.boolean().optional(),
      label: z.number().int().min(0).max(16).optional(),
      audioEnabled: z.boolean().optional(),
    },
    (args) => bridge.call("setLayerFlags", args)
  );

  tool(
    "ae_rename_layer",
    "Rename a layer.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      name: z.string(),
    },
    (args) => bridge.call("renameLayer", args)
  );

  tool(
    "ae_import_footage",
    "Import a file from disk into the AE project, optionally adding it as a layer to a composition in " +
      "the same call.",
    {
      filePath: z.string().describe("Absolute path to an image/video/audio file"),
      compIndex: z.number().int().positive().optional().describe("If given, also adds the footage as a layer here"),
    },
    (args) => bridge.call("importFootage", args)
  );

  tool(
    "ae_list_project_items",
    "List every item in the project panel (compositions, footage, and folders), including footage file " +
      "paths and whether a footage item's source is missing/offline.",
    {},
    () => bridge.call("listProjectItems")
  );

  tool(
    "ae_create_folder",
    "Create a folder in the project panel, for organizing items.",
    { name: z.string() },
    (args) => bridge.call("createFolder", args)
  );

  tool(
    "ae_replace_footage_source",
    "Replace a footage item's source file on disk, keeping every layer that uses it in sync.",
    {
      itemIndex: z.number().int().positive().describe("Project-panel index from ae_list_project_items"),
      filePath: z.string().describe("Absolute path to the replacement file"),
    },
    (args) => bridge.call("replaceFootageSource", args)
  );

  tool(
    "ae_list_available_fonts",
    "List fonts installed on this system, with postScriptName (use this value for ae_create_text's " +
      "'font' argument), family, and style. Unverified against a live AE instance yet — report back if " +
      "it errors.",
    {
      query: z.string().optional().describe("Case-insensitive filter on family/style/postScriptName"),
      maxResults: z.number().int().positive().optional(),
    },
    (args) => bridge.call("listAvailableFonts", args)
  );

  tool(
    "ae_list_presets",
    "Search for installed .ffx preset files on disk (searches common Adobe preset locations by default). " +
      "Runs entirely locally — does not round-trip through After Effects.",
    {
      query: z.string().optional().describe("Case-insensitive substring filter on filename/path"),
      roots: z.array(z.string()).optional().describe("Override the default search directories"),
      maxResults: z.number().int().positive().optional(),
    },
    (args) => listPresets(args)
  );

  tool(
    "ae_list_available_effects",
    "List effects installed in this After Effects, with display name and matchName — use this to find " +
      "the correct matchName for ae_apply_effect instead of guessing.",
    {
      query: z.string().optional().describe("Case-insensitive filter on name/matchName/category"),
      maxResults: z.number().int().positive().optional(),
    },
    (args) => bridge.call("listAvailableEffects", args)
  );

  tool(
    "ae_list_layers",
    "List layers in a composition with their name and 1-based index. Indices shift when layers are " +
      "added/removed/reordered — call this again before addressing a layer if the composition may have changed.",
    { compIndex: z.number().int().positive() },
    (args) => bridge.call("listLayers", args)
  );

  tool(
    "ae_list_effects",
    "List effects applied to a layer, with name, matchName, and 1-based effect index.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("listEffects", args)
  );

  tool(
    "ae_apply_effect",
    "Apply an effect to a layer by its ExtendScript matchName (e.g. 'ADBE Gaussian Blur 2', not the display " +
      "name). Returns the new effect's index — re-check with ae_list_effects rather than assuming it.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      matchName: z.string().describe("Effect matchName, e.g. 'ADBE Gaussian Blur 2'"),
      settings: z.record(z.any()).optional().describe("Optional map of property name -> initial value"),
    },
    (args) => bridge.call("applyEffect", args)
  );

  tool(
    "ae_remove_effect",
    "Remove one effect from a layer by its effect index. Get a fresh index from ae_list_effects first — " +
      "indices shift once effects are added or removed.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      effectIndex: z.number().int().positive(),
    },
    (args) => bridge.call("removeEffect", args)
  );

  tool(
    "ae_apply_effect_preset",
    "Apply a saved .ffx effect preset file to a layer.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      presetPath: z.string().describe("Absolute path to a .ffx preset file"),
    },
    (args) => bridge.call("applyEffectPreset", args)
  );

  tool(
    "ae_reorder_effect",
    "Move an effect to a different position in a layer's effect stack.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      effectIndex: z.number().int().positive(),
      toIndex: z.number().int().positive(),
    },
    (args) => bridge.call("reorderEffect", args)
  );

  tool(
    "ae_set_effect_enabled",
    "Enable or disable an effect without removing it.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      effectIndex: z.number().int().positive(),
      enabled: z.boolean(),
    },
    (args) => bridge.call("setEffectEnabled", args)
  );

  tool(
    "ae_set_effect_property",
    "Set a property on an already-applied effect. Pass timeInSeconds to set a keyframe instead of a static value.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      effectIndex: z.number().int().positive(),
      propertyName: z.string(),
      value: z.any(),
      timeInSeconds: z.number().optional(),
    },
    (args) => bridge.call("setEffectProperty", args)
  );

  tool(
    "ae_set_layer_property",
    "Set a layer transform property to a static value (no keyframe), e.g. propertyName 'Position', " +
      "'Scale', 'Rotation', 'Opacity', 'Anchor Point'. Use ae_set_layer_keyframe instead to animate it.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
      value: z.any(),
    },
    (args) => bridge.call("setLayerProperty", args)
  );

  tool(
    "ae_set_layer_keyframe",
    "Set a keyframe on a layer transform property, e.g. propertyName 'Position', 'Scale', 'Rotation', 'Opacity'.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
      timeInSeconds: z.number(),
      value: z.any(),
    },
    (args) => bridge.call("setLayerKeyframe", args)
  );

  tool(
    "ae_list_keyframes",
    "List every keyframe on a layer property, with time and value.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
    },
    (args) => bridge.call("listKeyframes", args)
  );

  tool(
    "ae_remove_keyframe",
    "Remove one keyframe (by keyframeIndex) or every keyframe (all: true) from a layer property.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
      keyframeIndex: z.number().int().positive().optional(),
      all: z.boolean().optional(),
    },
    (args) => bridge.call("removeKeyframe", args)
  );

  tool(
    "ae_set_keyframe_easing",
    "Set interpolation type and/or Easy Ease on an existing keyframe. Unverified against a live AE " +
      "instance yet — report back if it errors.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
      keyframeIndex: z.number().int().positive(),
      interpolationIn: z.enum(["linear", "bezier", "hold"]).optional(),
      interpolationOut: z.enum(["linear", "bezier", "hold"]).optional(),
      easyEase: z.boolean().optional(),
      easyEaseInfluence: z.number().min(0.1).max(100).optional().describe("Default 33.333"),
    },
    (args) => bridge.call("setKeyframeEasing", args)
  );

  tool(
    "ae_set_time_remapping",
    "Enable time remapping on a layer and optionally set a keyframe on it (value = source time in seconds).",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      timeInSeconds: z.number().optional(),
      value: z.number().optional().describe("Source time to map to, in seconds"),
    },
    (args) => bridge.call("setTimeRemapping", args)
  );

  tool(
    "ae_set_layer_motion_blur",
    "Toggle per-layer motion blur.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      enabled: z.boolean(),
    },
    (args) => bridge.call("setLayerMotionBlur", args)
  );

  tool(
    "ae_set_layer_expression",
    "Set an expression on a layer property. Pass an empty string for expressionString to clear it.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      propertyName: z.string(),
      expressionString: z.string(),
    },
    (args) => bridge.call("setLayerExpression", args)
  );

  tool(
    "ae_add_marker",
    "Add a marker. Omit layerIndex for a composition marker, or include it for a layer marker.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive().optional(),
      timeInSeconds: z.number(),
      comment: z.string().optional(),
    },
    (args) => bridge.call("addMarker", args)
  );

  tool(
    "ae_add_markers_bulk",
    "Add multiple markers in a single call.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive().optional().describe("Omit for composition markers"),
      markers: z.array(z.object({
        timeInSeconds: z.number(),
        comment: z.string().optional(),
      })).min(1),
    },
    (args) => bridge.call("addMarkersBulk", args)
  );

  tool(
    "ae_list_markers",
    "List existing markers on a composition or layer.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive().optional().describe("Omit for composition markers"),
    },
    (args) => bridge.call("listMarkers", args)
  );

  tool(
    "ae_remove_marker",
    "Remove one marker by its index (from ae_list_markers).",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive().optional().describe("Omit for composition markers"),
      markerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("removeMarker", args)
  );

  tool(
    "ae_get_current_time",
    "Get a composition's current time and work area.",
    { compIndex: z.number().int().positive() },
    (args) => bridge.call("getCurrentTime", args)
  );

  tool(
    "ae_set_current_time",
    "Set a composition's current time (moves the playhead).",
    {
      compIndex: z.number().int().positive(),
      timeInSeconds: z.number(),
    },
    (args) => bridge.call("setCurrentTime", args)
  );

  tool(
    "ae_set_work_area",
    "Set a composition's work area start and/or duration.",
    {
      compIndex: z.number().int().positive(),
      start: z.number().optional(),
      duration: z.number().optional(),
    },
    (args) => bridge.call("setWorkArea", args)
  );

  tool(
    "ae_get_layer_bounds",
    "Get a layer's bounding box (top/left/width/height) at a given time, defaulting to the comp's current time.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      timeInSeconds: z.number().optional(),
    },
    (args) => bridge.call("getLayerBounds", args)
  );

  tool(
    "ae_export_frame",
    "Save a single frame of a composition as a PNG file, at a given time (defaults to current time). " +
      "Useful for visually verifying a result without needing to look at the AE window. Unverified " +
      "against a live AE instance yet — report back if it errors.",
    {
      compIndex: z.number().int().positive(),
      outputPath: z.string().describe("Absolute .png output path"),
      timeInSeconds: z.number().optional(),
    },
    (args) => bridge.call("exportFrame", args)
  );

  tool(
    "ae_get_layer_audio_info",
    "Get basic audio info for a layer: whether it has audio, whether audio is enabled, and its source file path.",
    {
      compIndex: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
    },
    (args) => bridge.call("getLayerAudioInfo", args)
  );

  tool(
    "ae_render_composition",
    "Add a composition to the render queue and render it to outputPath. This blocks After Effects (and " +
      "this whole bridge) until rendering finishes, which can take a while for non-trivial comps — that's " +
      "inherent to how AE's render queue works, not a hang. IMPORTANT: without outputModuleTemplate, AE's " +
      "default output format applies (commonly H.264/MP4) and can silently override the extension in " +
      "outputPath — always check the response's actualOutputPath and succeeded fields rather than assuming " +
      "outputPath was used as given.",
    {
      compIndex: z.number().int().positive(),
      outputPath: z.string().describe("Absolute output file path"),
      renderSettingsTemplate: z.string().optional().describe("Name of a render settings template pre-configured in AE"),
      outputModuleTemplate: z.string().optional().describe("Name of an output module template pre-configured in AE (controls format/codec)"),
    },
    (args) => bridge.call("renderComposition", args, { timeoutMs: 10 * 60 * 1000 })
  );

  tool(
    "ae_batch",
    "Run multiple ae_* tool calls in one round trip, in order, inside a single AE undo group. Each item " +
      "is {tool, args} using the SAME tool names as normal (e.g. 'ae_create_solid'), not internal op names. " +
      "A failed item is recorded in its own result but does not stop later items from running. Use this to " +
      "cut round-trip latency for multi-step builds (e.g. a shape layer's group+primitive+fill+stroke).",
    {
      calls: z.array(z.object({
        tool: z.string().describe("An ae_* tool name, e.g. 'ae_create_solid'"),
        args: z.record(z.any()).optional(),
      })).min(1),
    },
    (args) => bridge.call("batch", {
      calls: args.calls.map((c) => ({ op: toolNameToOp(c.tool), args: c.args || {} })),
    })
  );

  tool(
    "ae_run_macro",
    "Run a JavaScript snippet inside After Effects that can call ops.* in a loop — one network round " +
      "trip and one undo group for the whole thing, no matter how many calls it makes. This is the fast " +
      "path for bulk structured construction (e.g. building 8 shapes with the same pattern) where " +
      "ae_batch's per-call overhead adds up. Op names inside the script use the same convention as " +
      "ae_batch's internal mapping: strip the 'ae_' prefix and camelCase the rest (ae_add_shape_group -> " +
      "ops.addShapeGroup, ae_create_solid -> ops.createSolid). Push anything you want back in the response " +
      "onto the pre-declared 'results' array. Example:\n" +
      "for (var i = 0; i < 8; i++) {\n" +
      "  var g = ops.addShapeGroup({compIndex: 2, layerIndex: 1, name: 'Node ' + i});\n" +
      "  ops.addShapePrimitive({compIndex: 2, layerIndex: 1, groupIndex: g.groupIndex, shapeType: 'rect', size: [260,110]});\n" +
      "  results.push(g);\n" +
      "}\n" +
      "This is NOT a sandbox — it's a blocklist (rejects scripts mentioning File/Folder/system/" +
      "ExternalObject/Socket/$./eval/ScriptUI/app.quit/app.project.save) that catches accidental misuse, " +
      "not a security boundary. Only call this against a bridge you trust the network exposure of.",
    {
      script: z.string().describe("JavaScript source; has 'ops' and 'results' available, nothing else from this bridge's own internals"),
    },
    (args) => bridge.call("runMacro", args, { timeoutMs: 60 * 1000 })
  );
}

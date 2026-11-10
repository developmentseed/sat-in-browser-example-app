import type { Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Props for the {@link SampleTexture2DArray} shader module.
 */
export type SampleTexture2DArrayProps = {
  /** The Texture2DArray to sample (r32float, depth = number of datetimes). */
  dataTex: Texture;
  /** Datetime frame index (as a float, for nearest sampling). */
  layerIndex: number;
};

const MODULE_NAME = "sampleTexture2DArray";

/**
 * A shader module that samples a sampler2DArray at (uv, layerIndex) and
 * writes the scalar value into `color.rgb`. Discards NaN fills.
 *
 * Intended to be composed with LinearRescale + Colormap downstream. Adapted
 * from developmentseed/deck.gl-raster's dynamical-zarr-ecmwf example, which
 * uses the same "stack all frames into one Texture2DArray, animate via
 * layerIndex" trick to avoid re-fetching tiles per frame.
 */
export const SampleTexture2DArray = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float layerIndex;
} ${MODULE_NAME};
`,
  inject: {
    "fs:#decl": `
precision highp sampler2DArray;
uniform sampler2DArray dataTex;
`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float v = texture(dataTex, vec3(geometry.uv, ${MODULE_NAME}.layerIndex)).r;
      if (isnan(v)) discard;
      color = vec4(v, v, v, 1.0);
    `,
  },
  uniformTypes: {
    layerIndex: "f32",
  },
  getUniforms: (props: Partial<SampleTexture2DArrayProps>) => {
    return {
      layerIndex: props.layerIndex ?? 0,
      dataTex: props.dataTex,
    };
  },
} as const satisfies ShaderModule<SampleTexture2DArrayProps>;

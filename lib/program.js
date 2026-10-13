/**
 * @description The <strong>program.js</strong> module renders DataPixels programs (".js" files such as
 * the examples) to PNG by executing them against the Node shims from environment.js.
 * @module
 *
 */
import fs from "node:fs";
import { ImageData } from "@napi-rs/canvas";
import { collectOutputs } from "./environment.js";

export {

    renderProgram
};

/**
 * @description Executes a DataPixels program and returns everything it appended to document.body as PNG.
 * The program runs as code: only render files you trust.
 * @param {string} filePath
 * @returns {Promise<Buffer[]>}
 * @public
 *
 */
async function renderProgram(filePath) {

    const { default: DataPixels } = await import("./DataPixels.js");

    const code = fs.readFileSync(filePath, "utf8").replace(/^\s*import .*?[;\n]/gmi, "");
    const run = new Function("DataPixels", "document", "Image", "ImageData", code);

    run(DataPixels, globalThis.document, globalThis.Image, ImageData);

    const outputs = collectOutputs(globalThis.document.body);

    if (!outputs.length) {

        throw new Error("The program did not append a canvas or image to document.body.");
    }

    return outputs;
}

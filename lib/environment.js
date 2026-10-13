/**
 * @description The <strong>environment.js</strong> module provides the minimal browser globals (ImageData, document, Image)
 * that DataPixels.js expects, so that the class can run unchanged under Node.js.
 * @module
 *
 */
import { createCanvas, ImageData } from "@napi-rs/canvas";

export {

    collectOutputs,
    createDocument
};

/**
 * @description A stand-in for HTMLImageElement.  DataPixels only assigns a data URL to its "src".
 * @private
 *
 */
class ShimImage {

    constructor() {

        this.style = {};
        this.src = "";
    }
}

/**
 * @description A stand-in for a generic DOM element (e.g., a container div) that only tracks its children.
 * @private
 *
 */
class ShimElement {

    constructor(tagName) {

        this.tagName = tagName;
        this.style = {};
        this.children = [];
    }

    appendChild(child) {

        this.children.push(child);

        return child;
    }
}

/**
 * @description Installs the globals required by DataPixels.js and returns the fake document.
 * @returns {Object} The document whose body collects everything appended by the executed code.
 * @public
 * @function
 *
 */
function createDocument() {

    const body = new ShimElement("body");

    const document = {

        body,
        createElement(tagName) {

            if (tagName === "canvas") {

                const canvas = createCanvas(1, 1);
                canvas.style = {};

                return canvas;
            }

            if (tagName === "img") return new ShimImage();

            return new ShimElement(tagName);
        }
    };

    globalThis.ImageData = ImageData;
    globalThis.Image = ShimImage;
    globalThis.document = document;

    return document;
}

/**
 * @description Walks the fake document tree and returns every canvas or image as PNG data.
 * @param {Object} root - The element to search, usually document.body.
 * @returns {Buffer[]} PNG buffers in document order.
 * @public
 * @function
 *
 */
function collectOutputs(root) {

    const outputs = [];

    const visit = (node) => {

        if (node instanceof ShimImage) {

            const match = /^data:image\/png;base64,(.*)$/.exec(node.src);

            if (match) {

                outputs.push(Buffer.from(match[1], "base64"));
            }
        }
        else if (typeof node.toBuffer === "function") {

            outputs.push(node.toBuffer("image/png"));
        }
        else if (node.children) {

            node.children.forEach(visit);
        }
    };

    visit(root);

    return outputs;
}

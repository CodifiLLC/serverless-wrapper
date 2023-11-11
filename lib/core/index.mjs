export { getData } from './package-parser.mjs';

export class WrapperContext {
    getParams() {
        return {};
    }

    getRemainingRuntime() {
        return 100;
    }

    getEnv() {
        return process.env;
    }

    getHttpData() {
        return {
            method: '',
            path: '',
            headers: {}
        }
    }

    invokeFunction(functionName, params) {

    }
}

export class LocalWrapperContext extends WrapperContext {
    #httpParams;
    #functionParams;
    #startTime = Date.now();
    #maxRunTime;

    constructor(http, params, maxRunTime = 30000) {
        super();
        this.#httpParams = http;
        this.#functionParams = params;
        this.#maxRunTime = Date.now() + maxRunTime;
    }

    getRemainingRuntime() {
        return this.#maxRunTime - this.#startTime;
    }

    getParams() {
        return this.#functionParams;
    }

    getHttpData() {
        return this.#httpParams;
    }

}

/**
 * @typedef {object} ServerlessResponse
 * @property {number} status
 * @property {object} headers,
 * @property {string|object|[]} body
 */

/**
 * Core response translation function
 * @param result
 * @returns ServerlessResponse
 */
export const response = (result) => {
    return {
        status: result.status || 500,
        body: result.body || '',
        headers: result.headers || {},
    };
};

/**
 * Returns a successful response
 * @param {string|object} body The body to return to the client
 * @param {object} [headers] Extra headers to return to the client
 * @returns {ServerlessResponse}
 */
export const ok = (body, headers) => {
    return response({
       status: 200,
       body,
       headers: headers || [],
    });
};

/**
 * Return a binary response
 * @param {[]} body The binary data to send to the client
 * @param {string} mimeType The MIME Type to send to the client
 * @param {object} [headers] Extra headers to return to the client
 * @param {string} [filename] The filename to return to the client
 * @returns {ServerlessResponse}
 */
export const binary = (body, mimeType, headers, filename) => {
    const baseHeaders = {
        'Content-Type': mimeType,
        'Content-Length': body.length,
    };
    if (filename) {
        baseHeaders['Content-disposition'] = 'attachment;filename=' + filename;
    }
    return response({
        status: 200,
        body,
        headers: {...baseHeaders, ...(headers || {})},
    });
};

/**
 * Return a forbidden response
 * @param {string} [message] Optional error message to return
 * @returns {ServerlessResponse}
 */
export const forbidden = (message) => {
    return response({
        status: 403,
        body: message || 'Forbidden'
    });
};

/**
 * Return a unauthorized response
 * @param {string} [message] Optional error message to return
 * @returns {ServerlessResponse}
 */
export const unauthorized = (message) => {
    return response({
        status: 401,
        body: message || 'Unauthorized'
    });
};
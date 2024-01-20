import {LocalWrapperContext} from '@serverless-wrapper/core';

export class ExpressWrapperContext extends LocalWrapperContext {
    #functionMap = {};
    #callDepth;

    constructor(http, params, functionMap, maxRunTime = 30000, callDepth = 0) {
        super(http, params, maxRunTime);
        this.#functionMap = functionMap;
        this.#callDepth = callDepth;
    }

    invokeFunction(functionPath, params) {
        if (this.#callDepth < 6 && this.#functionMap[functionPath]) {
            this.#functionMap[functionPath](new ExpressWrapperContext(
                this.http,
                params,
                this.#functionMap,
                10000,
                this.#callDepth + 1
            ));
        }
    }
}
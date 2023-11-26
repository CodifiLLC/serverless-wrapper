import {WrapperContext} from "@serverless-wrapper/core";


//https://docs.digitalocean.com/products/functions/reference/parameters-responses/
//https://docs.digitalocean.com/products/functions/reference/runtimes/node-js/#context-parameter

export class DoWrapperContext extends WrapperContext {
	#ctx;
	#http;
	#params;
	constructor(event, ctx) {
		super();
		this.#ctx = ctx;
		this.#http = event.http;
		delete event.http;
		this.#params = event;
	}

	getParams() {
		return this.#params;
	}

	getHttpData() {
		return this.#http;
	}

	getRemainingRuntime() {
		this.#ctx.getRemainingTimeInMillis();
	}

}
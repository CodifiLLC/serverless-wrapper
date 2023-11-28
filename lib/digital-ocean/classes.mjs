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
		delete event.__ow_headers;
		delete event.__ow_method;
		delete event.__ow_path;
		this.#params = event;
	}

	getParams() {
		return this.#params;
	}

	getHttpData() {
		return this.#http;
	}

	getRemainingRuntime() {
		return this.#ctx.getRemainingTimeInMillis();
	}

}
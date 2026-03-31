import {WrapperContext} from "@serverless-wrapper/core";

export class AwsWrapperContext extends WrapperContext {
	#ctx;
	#event;
	constructor(event, ctx) {
		super();
		this.#event = event;
		this.#ctx = ctx;
	}

	getParams() {
		const query = this.#event.queryStringParameters;
		const body = typeof this.#event.body == 'string' ? JSON.parse(this.#event.body) : (typeof this.#event.body !== 'undefined' ? {body: this.#event.body} : {});
		return {
			...query,
			...body
		};
	}

	getHttpData() {

		return {
			method: this.#event.requestContext.http.method,
			path: this.#event.requestContext.http.path,
			headers: this.#event.headers,
		};
	}

	getRemainingRuntime() {
		return this.#ctx.getRemainingTimeInMillis();
	}

}
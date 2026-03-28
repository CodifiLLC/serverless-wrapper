import {AwsWrapperContext} from "./classes.mjs";

export async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const esModMap = { PATH: 'FUNCTION_CONFIG' };
	const targettedFunction = esModMap[event.rawPath];
	if (!targettedFunction) return { statusCode: 404, body: `${event.rawPath} not found`, headers: {}};
	const esMod = esModMap[event.rawPath] ? await import(targettedFunction.path) : null;

	const wrapper = new AwsWrapperContext(event, ctx);

	for (const authPath of targettedFunction.authMiddleware) {
		const authFunc = await import(authPath);
		const isAuthed = await Promise.resolve(authFunc.default(wrapper));
		if (!isAuthed) {
			return Promise.reject('Unauthorized');
			// return { statusCode: 401, body: 'Unauthorized', headers: {} };
		}
	}

	try {
		for (const mwPath of targettedFunction.otherMiddleware) {
			const mwFunc = await import(mwPath);
			await Promise.resolve(mwFunc.default(wrapper));
		}
	} catch (middlewareError) {
		return Promise.reject(middlewareError.message);
		// return {body: middlewareError.message, statusCode: 500, headers: {}};
	}

	//TODO handle other middleware

	const { body, statusCode, headers } = await esMod.main(wrapper);
	if (statusCode < 200 || statusCode > 299) return Promise.reject(body);

	return body;
	// return {
	// 	isBase64Encoded: false,
	// 	statusCode,
	// 	headers,
	// 	multiValueHeaders: {}, //{ "headerName": ["headerValue", "headerValue2", ...], ... },
	// 	body: JSON.stringify(body),
	// };//  {body, statusCode, headers};
}


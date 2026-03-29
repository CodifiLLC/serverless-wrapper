import {AwsWrapperContext} from "./classes.mjs";
/**{IMPORTS}**/

export async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const esModMap = { PATH: 'FUNCTION_CONFIG' };
	const esMod = esModMap[event.rawPath];
	if (!esMod) return { statusCode: 404, body: `${event.rawPath} not found`, headers: {}};

	const wrapper = new AwsWrapperContext(event, ctx);

	for (const authFunc of esMod.authMiddleware) {
		const isAuthed = await Promise.resolve(authFunc(wrapper));
		if (!isAuthed) {
			return Promise.reject('Unauthorized');
			// return { statusCode: 401, body: 'Unauthorized', headers: {} };
		}
	}

	try {
		for (const mwFunc of esMod.otherMiddleware) {
			await Promise.resolve(mwFunc(wrapper));
		}
	} catch (middlewareError) {
		return Promise.reject(middlewareError.message);
		// return {body: middlewareError.message, statusCode: 500, headers: {}};
	}

	//TODO handle other middleware

	const { body, statusCode, headers } = await esMod.func(wrapper);
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


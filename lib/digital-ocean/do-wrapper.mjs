import {DoWrapperContext} from "./classes.mjs";

export async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const esMod = await import('./app/ENTRYPOINT_FILE.mjs');

	const wrapper = new DoWrapperContext(event, ctx);

	const AUTH_MIDDLEWARE = [];
	const OTHER_MIDDLEWARE = [];
	for (const authPath of AUTH_MIDDLEWARE) {
		const authFunc = await import(authPath);
		const isAuthed = await Promise.resolve(authFunc.default(wrapper));
		if (!isAuthed) {
			return { statusCode: 401, body: 'Unauthorized' };
		}
	}

	try {
		for (const mwPath of OTHER_MIDDLEWARE) {
			const mwFunc = await import(mwPath);
			await Promise.resolve(mwFunc.default(wrapper));
		}
	} catch (middlewareError) {
		return {body: middlewareError.message, statusCode: 500, headers: []};
	}

	//TODO handle other middleware

	const { body, status: statusCode, headers } = await esMod.main(wrapper);
	return {body, statusCode, headers};
}


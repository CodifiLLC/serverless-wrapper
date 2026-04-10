import { DoWrapperContext } from "./classes.mjs";
import { main as mainFunc } from './app/ENTRYPOINT_FILE.mjs';

/** MW_IMPORTS **/

export async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const wrapper = new DoWrapperContext(event, ctx);

	const AUTH_MIDDLEWARE = [];
	const OTHER_MIDDLEWARE = [];
	for (const authFunc of AUTH_MIDDLEWARE) {
		const isAuthed = await Promise.resolve(authFunc(wrapper));
		if (!isAuthed) {
			return { statusCode: 401, body: 'Unauthorized' };
		}
	}

	try {
		for (const mwFunc of OTHER_MIDDLEWARE) {
			await Promise.resolve(mwFunc(wrapper));
		}
	} catch (middlewareError) {
		return {body: middlewareError.message, statusCode: 500, headers: []};
	}

	//TODO handle other middleware

	const { body, status: statusCode, headers } = await mainFunc(wrapper);
	return {body, statusCode, headers};
}


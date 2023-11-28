import {DoWrapperContext} from "./classes.mjs";

export async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const esMod = await import('./app/index.mjs');

	const arg = new DoWrapperContext(event, ctx);

	//TODO handle middleware

	const { body, status: statusCode, headers} = await esMod.main(arg);
	return {body, statusCode, headers};
}


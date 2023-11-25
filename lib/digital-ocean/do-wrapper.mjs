import {DoWrapperContext} from "./classes.mjs";

async function main(event, ctx) {
	//TODO allow for configuration of function file and name
	const esMod = await import('./index.mjs');

	const arg = new DoWrapperContext(event, ctx);

	//TODO handle middleware

	return esMod.main(arg);
}

exports.main = main;

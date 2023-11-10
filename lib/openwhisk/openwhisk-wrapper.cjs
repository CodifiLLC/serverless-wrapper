/**
 * License MIT
 * Codifi LLC
 * 2023-10-22 Wrapper to allow OpenWhisk to use standarized function interface (based on Digital Ocean format)
 */
const KNOWN_KEYS = [];

async function main(params) {
	console.log('running cjs')
	const esMod = await import('./index.mjs');
	//onsole.log('got module');
	const headers = params.__ow_headers;
	const http = {
		method: params.__ow_method, 
		path: params.__ow_path,
		headers
	};
	const env = Object.fromEntries(
		KNOWN_KEYS.map(k => [k, params[k]]).filter(v => v[1])
	);
	        
	/*const trimmedHeaders = Object.keys(params)
		.filter(k => !k.startsWith('__ow_'))
		.reduce((agg, cur) => ({...agg, [cur]: params[cur]}), {}); */

	const standardizedParams = {
		http,
		env,
		...Object.keys(params)
                	.filter(k => !k.startsWith('__ow_') && !KNOWN_KEYS.includes(k))
                	.reduce((agg, cur) => ({...agg, [cur]: params[cur]}), {})
	};
	/*return {
		body: standardizedParams,
	};*/
	return esMod.main(standardizedParams);
}

exports.main = main;

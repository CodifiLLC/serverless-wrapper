import fs from 'fs';
import {fileURLToPath} from 'url';
import path from 'path';
import yaml from 'yaml';

/**
 * @typedef {object} ServerlessWrapperCorsConfig
 * @property {string[]} origins
 * @property {string[]} methods
 * @property {string[]} headers
 */

/**
 * @typedef {object} ServerlessWrapperMiddlewareConfig
 * @property {string} path
 * @property {'authentication'} [type]
 */

/**
 * @typedef {object} ServerlessWrapperFunctionConfig
 * @property {string} url
 * @property {string} path
 * @property {string} indexPath
 * @property {string} functionName
 * @property {string} packageName
 * @property {ServerlessWrapperCorsConfig} cors
 * @property {ServerlessWrapperMiddlewareConfig[]} middleware
 */

/**
 * @typedef {object} ServerlessWrapperConfig
 * @property {string[]} envKeys
 * @property {object} envMap
 * @property {ServerlessWrapperCorsConfig} cors
 * @property {ServerlessWrapperMiddlewareConfig[]} middleware
 * @property {ServerlessWrapperFunctionConfig[]} functions
 */

/**
 * @typedef {object} ServerlessWrapperConfigParams
 * @property {string} projectFile
 * @property {string} packageDirectory
 */

function getConfiguration(obj, cwd, existingConfig) {

	const env = {
		...(existingConfig.envMap || {}),
		...(obj.environment || {})
	};

	const objMiddleware = (obj.middleware || []).map(m => ({
		path: path.join(cwd, m.path),
		type: m.type
	}));
	const objCors = {
		origins: obj?.middleware?.origins ?? [],
		methods: obj?.middleware?.methods ?? [],
		headers: obj?.middleware?.headers ?? [],
	};
	const existingCors = {
		origins: existingConfig.cors?.origins ?? [],
		methods: existingConfig.cors?.methods ?? [],
		headers: existingConfig.cors?.headers ?? [],
	};

	const middleware = [
		...(existingConfig.middleware || []),
		...objMiddleware
	];
	const cors = {
		origins: [...existingCors.origins, ...objCors.origins],
		methods: [...existingCors.methods, ...objCors.methods],
		headers: [...existingCors.headers, ...objCors.headers],
	};

	return {
		envKeys: Object.keys(env).map(k => k.trim()),
		envMap: env,
		cors,
		middleware,
	};
}

/**
 * Parse the project configuration file and return the function definition data
 * @param {ServerlessWrapperConfigParams} [parseParameters]
 * @returns ServerlessWrapperConfig
 */
export function getData({projectFile = 'project.yml', packageDirectory = 'packages'} = {}) {
	const cwd = process.cwd();
	//TODO extend to json
	const obj = yaml.parse(fs.readFileSync(path.join(cwd, projectFile), 'utf8'));

	const baseConfig = getConfiguration(obj, cwd, {});

	const keys = Object.keys(obj.environment).map(k => k.trim());
	const middleware = (obj.middleware || []).map(m => ({
		path: path.join(cwd, m.path),
		type: m.type
	}));
	const functions = Object.values(obj.packages)
		.map(packageObj => {
			const packageConfig = getConfiguration(packageObj, cwd, baseConfig);
			return Object.values(packageObj.functions)
				.map(funcObj => {
					const {envKeys, envMap, cors, middleware} = getConfiguration(funcObj, cwd, packageConfig);

					return {
						envKeys,
						envMap,
						cors,
						middleware,
						url: `/${packageObj.name}/${funcObj.name}`,
						path: path.join(cwd, packageDirectory, packageObj.name, funcObj.name),
						indexPath: path.join(cwd, packageDirectory, packageObj.name, funcObj.name, funcObj.entry ?? 'index.mjs'),
						functionName: funcObj.name,
						packageName: packageObj.name,
					};
				})
		}).flat(1);

	return {envKeys: keys, middleware, envMap: obj.environment, functions}
}

export const AUTHORIZATION_MW_TYPE = 'authorization';

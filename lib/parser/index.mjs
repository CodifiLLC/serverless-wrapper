import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import yaml from 'yaml';

/**
 * @typedef {object} ServerlessWrapperFunctionConfig
 * @property {string} url
 * @property {string} path
 * @property {string} indexPath
 * @property {string} functionName
 * @property {string} packageName
 */

/**
 * @typedef {object} ServerlessWrapperConfig
 * @property {string[]} envKeys
 * @property {object} envMap
 * @property {ServerlessWrapperFunctionConfig[]} functions
 */

/**
 * @typedef {object} ServerlessWrapperConfigParams
 * @property {string} projectFile
 * @property {string} packageDirectory
 */

/**
 * Parse the project configuration file and return the function definition data
 * @param {ServerlessWrapperConfigParams} [parseParameters]
 * @returns ServerlessWrapperConfig
 */
export function getData({projectFile = 'project.yml', packageDirectory = 'packages'} = {}) {
    const cwd = process.cwd();
    //TODO extend to json
    const obj = yaml.parse(fs.readFileSync(path.join(cwd, projectFile), 'utf8'));
    const keys = Object.keys(obj.environment).map(k => k.trim());
    const middleware = obj.middleware.map(m => ({
        path: path.join(cwd, m.path),
        type: m.type
    }));
    const functions = Object.values(obj.packages)
        .map(packageObj => Object.values(packageObj.functions)
            .map(funcObj => ({
                url: `/${packageObj.name}/${funcObj.name}`,
                path: path.join(cwd, packageDirectory, packageObj.name, funcObj.name),
                indexPath: path.join(cwd, packageDirectory, packageObj.name, funcObj.name, funcObj.entry ?? 'index.mjs'),
                functionName: funcObj.name,
                packageName: packageObj.name,
            }))
        ).flat(1);

    return {envKeys: keys, middleware, envMap: obj.environment, functions}
}

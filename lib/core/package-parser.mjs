import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
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
 * Parse the project configuration file and return the function definition data
 * @returns ServerlessWrapperConfig
 */
export function getData() {
    const cwd = process.cwd();
    //TODO extend to json
    const obj = yaml.parse(fs.readFileSync(path.join(cwd, './project.yml'), 'utf8'));
    const keys = Object.keys(obj.environment).map(k => k.trim());
    const functions = Object.values(obj.packages)
        .map(packageObj => Object.values(packageObj.functions)
            .map(funcObj => ({
                url: `/${packageObj.name}/${funcObj.name}`,
                path: path.join(cwd, 'packages', packageObj.name, funcObj.name),
                indexPath: path.join(cwd, 'packages', packageObj.name, funcObj.name, 'index.mjs'),
                functionName: funcObj.name,
                packageName: packageObj.name,
            }))
        ).flat(1);

    return {envKeys: keys, envMap: obj.environment, functions}
}

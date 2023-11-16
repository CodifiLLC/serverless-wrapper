/**
 * License MIT
 * Codifi LLC
 * 2023-10-22 Build script to deploy to OpenWhisk using standarized function interface (based on Digital Ocean format)
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import path from 'path';
import archiver from 'archiver';
import {getData} from "@serverless-wrapper/parser";

const functionData = getData();
const paramList = Object.entries(functionData.envMap).map(([key, value]) => `--param ${key} ${value}`).join(' ');

const DEPLOY_FOLDER = process.env.BUILD_TMP_DIR ?? './deploy';
const WSK_PATH = `${process.env.WSK_HOME ? process.env.WSK_HOME + '/' : ''}wsk`;

function buildZip(funcName) {
	return new Promise((res, rej) => {
		const zipName = `deploy-${funcName}.zip`;
		//TODO process.cwd??
		const curDir = path.dirname(fileURLToPath(import.meta.url));

		// create a file to stream archive data to.
		//console.log(`${__dirname}/deploy-${funcName}.zip`);
		console.log('  writing zip', path.join(curDir, zipName));
		const output = fs.createWriteStream(path.join(curDir, zipName));
		const archive = archiver('zip', {
		  zlib: { level: 9 } // Sets the compression level.
		});

		// listen for all archive data to be written
		// 'close' event is fired only when a file descriptor is involved
		output.on('close', function() {
			console.log('  ' + archive.pointer() + ' total bytes');
			console.log('  archiver has been finalized and the output file descriptor has closed.');
			res(zipName);
		});

		// This event is fired when the data source is drained no matter what was the data source.
		// It is not part of this library but rather from the NodeJS Stream API.
		// @see: https://nodejs.org/api/stream.html#stream_event_end
		output.on('end', function() {
			console.log('Data has been drained');
		});

		// good practice to catch warnings (ie stat failures and other non-blocking errors)
		archive.on('warning', function(err) {
			if (err.code === 'ENOENT') {
				// log warning
				console.log('File missing!');
			} else {
				// throw error
				throw err;
			}
		});

		// good practice to catch this error explicitly
		archive.on('error', function(err) {
			rej(err);
		});

		// pipe archive data to the file
		archive.pipe(output);
		archive.directory(path.join(curDir, DEPLOY_FOLDER), false);
		archive.finalize();
	});
}


function invokeOpenWhiskCmd(subcommand) {
	const cmd = `${WSK_PATH} ${subcommand}`;
	return new Promise((resolve, reject) => {
		console.log(' > ' + cmd);
		exec(cmd, (err, stdout, stderr) => {
			if (err) {
				// node couldn't execute the command
				return reject(err);
			}
			if (stderr && stderr.trim().length > 0) {
				return reject(stderr);
			}
			resolve(stdout);
		});
	});
}
async function getFunctionNames() {
	const funcs = await invokeOpenWhiskCmd('action list');
	return funcs.split('\n')
		.slice(1)
		.map(l => l.split(' ')[0]?.replace('/guest/', ''))
		.filter(Boolean);
}
async function getPackageNames() {
	const packages = await invokeOpenWhiskCmd('package list');
	return packages.split('\n')
		.slice(1)
		.map(l => l.split(' ')[0]?.replace('/guest/', ''))
		.filter(Boolean);

}
const existingFunctions = await getFunctionNames();
const existingPackages = await getPackageNames();
async function verifyPackageExists(packageName) {
	if (!existingPackages.includes(packageName)) {
		return invokeOpenWhiskCmd(`package create ${packageName}`)
			.then(r => {
				console.log('  created package:', r);
				existingPackages.push(packageName);
			})
			.catch(e => {
				console.log('  unable to create package', e);
				throw e;
			});

	}
}
function invokeOpenWhiskDeploy(zipName, functionPath) {
	const action = existingFunctions.includes(functionPath) ? 'update' : 'create';
	return invokeOpenWhiskCmd(`action ${action} ${functionPath} --kind nodejs:20 ${zipName} ${paramList} --web true`)
			.then(r => {
				console.log('  success:', r);
				if (action === 'create') {
					existingFunctions.push(functionPath);
				}
			})
			.catch(e => console.log('  unable to deploy function', e));
}

//console.log(existingFunctions, existingPackages);

for (const packageObj of functionData.functions) {
	console.log(`package ${packageObj.path}`);
	console.log('..assembling deploy');
	if (!fs.existsSync(DEPLOY_FOLDER)) {
		fs.mkdirSync(DEPLOY_FOLDER);
	}
	fs.writeFileSync(
		path.join(DEPLOY_FOLDER, 'index.cjs'),
		fs.readFileSync('./openwhisk-wrapper.cjs', 'utf8')
			.replace(/const KNOWN_KEYS = \[\]/, `const KNOWN_KEYS = ['${functionData.envKeys.join("', '")}']`)
	);
	const funcFiles = fs.readdirSync(packageObj.path)
				.filter(f => /\..?js/.test(f))
				.map(funcFile => ({
					src: path.join('packages', packageObj.path, funcFile),
					dest: path.join(DEPLOY_FOLDER, funcFile)
				}));
	funcFiles.forEach(({src, dest}) => fs.cpSync(src, dest));

	console.log('..zipping');
	const zipName = await buildZip(packageObj.packageName);

	console.log('..deploying');
	await verifyPackageExists(packageObj.packageName);
	await invokeOpenWhiskDeploy(zipName, packageObj.url.substring(1));
	//process.exit(0)
}

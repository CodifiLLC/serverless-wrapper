import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import path from 'path';
import archiver from 'archiver';
import yaml from 'yaml';
import {getData} from "@serverless-wrapper/parser";

// https://docs.digitalocean.com/products/functions/reference/build-process/

const functionData = getData();

const DEPLOY_FOLDER = path.join(process.env.BUILD_TMP_DIR ?? './dist', 'do');
const DOCTL_PATH = `${process.env.DOCTL_HOME ? process.env.DOCTL_HOME + '/' : ''}doctl`;

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


function invokeDoctlCommand(subcommand) {
	const cmd = `${DOCTL_PATH} ${subcommand}`;
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

function invokeDoctlDeploy(path) {
	return invokeDoctlCommand('serverless deploy ' + path)
			.then(r => {
				console.log('  success:', r);
			})
			.catch(e => console.log('  unable to deploy function', e));
}

//console.log(existingFunctions, existingPackages);

const doPkgDir = path.dirname(fileURLToPath(import.meta.url));
const projObj = {
	parameters: {},
	packages: []
};
const libPath = path.join(DEPLOY_FOLDER, 'lib');
if (!fs.existsSync(libPath)) {
	fs.mkdirSync(libPath, {recursive: true});
}

for (const func of functionData.functions) {
	console.log(`package ${func.path}`);
	console.log('..assembling deploy');
	const funcDeployPath = path.join(DEPLOY_FOLDER, 'packages', func.packageName, func.functionName);
	if (!fs.existsSync(funcDeployPath)) {
		fs.mkdirSync(funcDeployPath, {recursive: true});
	}

	let packageObj = projObj.packages.find(p => p.name === func.packageName);
	if (!packageObj) {
		 packageObj = {
		 	name: func.packageName,
			 functions: []
		 };
		 projObj.packages.push(packageObj);
	}
	packageObj.functions.push({
		name: func.functionName,
		binary: false,
		main: 'do-wrapper.mjs',
		environment: Object.fromEntries(
			Object.entries(func.envMap)
				.map(([key, value]) => [key, value?.toString()])
		),
		runtime: 'nodejs:18',
		web: true,
		websecure: false,
		parameters: {}
	});

	fs.writeFileSync(
		path.join(funcDeployPath, 'do-wrapper.mjs'),
		fs.readFileSync(path.join(doPkgDir, 'do-wrapper.mjs'), 'utf8')
	);
	const funcFiles = fs.readdirSync(func.path)
				// .filter(f => /\..?js/.test(f))
				.map(funcFile => ({
					src: path.join(func.path, funcFile),
					dest: path.join(funcDeployPath, funcFile)
				}));
	funcFiles.forEach(({src, dest}) => fs.cpSync(src, dest));

	// const zipName = await buildZip(func.packageName);

	console.log('..deploying');
	// await verifyPackageExists(func.packageName);
	//process.exit(0)
}
fs.writeFileSync(
	path.join(DEPLOY_FOLDER, 'project.yml'),
	yaml.stringify(projObj)
);
await invokeDoctlDeploy(DEPLOY_FOLDER);

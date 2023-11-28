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

// https://github.com/archiverjs/node-archiver/issues/402#issuecomment-560169118
function walk(dir, topDir) {
	if (!topDir) {
		topDir = dir;
	}
	const files = fs.readdirSync(dir)
        .map(file => {
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) return walk(filePath, topDir);
            else if(stats.isFile()) return {relativePath: filePath.substring(topDir.length + 1), fullPath: filePath};
        });
	return files.reduce((all, folderContents) => all.concat(folderContents), []);
}

// let entries = await walk(source_path);
// entries.forEach(entry=>{
// 	let subpath = entry.substring(source_path.length);
// 	console.log(entry, file.dest+subpath);
// 	archive.append(fs.createReadStream(entry), {name: file.dest+subpath});
// });

function buildZip(dirname, runFn) {
	return new Promise((res, rej) => {
		const zipName = 'deploy.zip';
		//TODO process.cwd??

		// create a file to stream archive data to.
		//console.log(`${__dirname}/deploy-${funcName}.zip`);
		console.log('  writing zip', path.join(dirname, zipName));
		const output = fs.createWriteStream(path.join(dirname, zipName));
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
		if (runFn) {
			runFn(archive);
		}

		// archive.directory(path.join(dirname, 'files'), false);
		archive.finalize();
	});
}


function invokeCommand(cmd) {
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

function invokeDoctlCommand(subcommand) {
	const cmd = `${DOCTL_PATH} ${subcommand}`;
	return invokeCommand(cmd);
}

function invokeDoctlDeploy(path) {
	return invokeDoctlCommand('serverless deploy ' + path)
			.then(r => {
				console.log('  success:', r);
			})
			.catch(e => console.log('  unable to deploy function', e));
}

// Hacky fix to get node_modules installed in prod mode.
// 1) move real folder
// 2) reinstall in prod mode
// 3) move that to a custom folder
// 4) move original back
async function prepNodeModules() {
	const nm = 'node_modules';
	const nm_real = `${nm}.real`;
	const nm_prod = `${nm}.production`;
	try {
		if (fs.existsSync(nm) && !fs.existsSync(nm_real)) {
			fs.renameSync(nm, nm_real);
		}
		await invokeCommand('npm install --omit=dev');
		if (fs.existsSync(nm_prod)) {
			fs.rmSync(nm_prod, {recursive: true, force: true});
		}
		fs.renameSync(nm, nm_prod);
		fs.renameSync(nm_real, nm);
	} catch (e) {
		console.log('error', e);
		if (fs.existsSync(nm_real)) {
			fs.renameSync(nm_real, nm);
		}
	}
}

//console.log(existingFunctions, existingPackages);

// Ensure that there is a node_modules.production folder
await prepNodeModules();

const doPkgDir = path.dirname(fileURLToPath(import.meta.url));
const projObj = {
	parameters: {},
	packages: []
};

// Create the required lib folder (empty)
const libPath = path.join(DEPLOY_FOLDER, 'lib');
if (!fs.existsSync(libPath)) {
	fs.mkdirSync(libPath, {recursive: true});
}

// Build each function into a zip in the dist folder (nested appropriately)
for (const func of functionData.functions) {
	console.log(`package ${func.path}`);
	console.log('..assembling deploy');

	// Make sure that the package file is setup
	const funcRootPath = path.join(DEPLOY_FOLDER, 'packages', func.packageName, func.functionName);
	if (!fs.existsSync(funcRootPath)) {
		fs.mkdirSync(funcRootPath, {recursive: true});
	}

	// Open the zip file, fill it with the following code, and then write it to disk
	await buildZip(funcRootPath, zip => {
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
			// main: 'do-wrapper.mjs',
			environment: Object.fromEntries(
				Object.entries(func.envMap)
					.map(([key, value]) => [key, value?.toString()])
			),
			runtime: 'nodejs:18',
			web: true,
			websecure: false,
			parameters: {}
		});

		// Add wrapper files
		zip.file(
			path.join(doPkgDir, 'do-wrapper.mjs'),
			{name: 'index.mjs'},
		);
		zip.file(
			path.join(doPkgDir, 'classes.mjs'),
			{name: 'classes.mjs'},
		);

		// Add all function files
		const funcFiles = walk(func.path);
		funcFiles
			.forEach(entry => {
				console.log('adding file', func.path, entry.relativePath);
				zip.file(entry.fullPath, {name: `app/${entry.relativePath}`});
			});
		const cwd = process.cwd();

		//TODO Add middleware to the 'middleware' folder and inject these values into the do-wrapper to be called.

		// include root node modules (in production mode)
		if (!fs.existsSync(path.join(func.path, 'node_modules')) && fs.existsSync(path.join(cwd, 'package.json'))) {
			// TODO update to write 'main' entry to point to do-wrapper.mjs
			zip.file(path.join(cwd, 'package.json'), {name: 'package.json'});
			// zip.directory(path.join(cwd, 'node_modules'), 'node_modules');
			const node_mod_path = path.join(cwd, 'node_modules.production');
			let entries = walk(node_mod_path);
			console.log('entries', entries);
			entries.forEach(entry => {
				console.log(entry);
				zip.append(fs.createReadStream(entry.fullPath), {name: 'node_modules/' + entry.relativePath});
			});
		}
	});

}

// Write project file
fs.writeFileSync(
	path.join(DEPLOY_FOLDER, 'project.yml'),
	yaml.stringify(projObj)
);

// Invoke doctl command
await invokeDoctlDeploy(DEPLOY_FOLDER);

import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import path from 'path';
import archiver from 'archiver';
import yaml from 'yaml';
import {getData, AUTHORIZATION_MW_TYPE} from "@serverless-wrapper/parser";

const BUILD_ONLY_FLAG = '--build-only';
const DEPLOY_ONLY_FLAG = '--deploy-only';
const FUNCTION_LIMIT_FLAG = '--function';

const isBuildOnly = process.argv.includes('--build-only');
const isDeployOnly = process.argv.includes('--deploy-only');
const functionsToDeploy = process.argv.filter(p => p.startsWith(`${FUNCTION_LIMIT_FLAG}=`)).map(p => p.replace(`${FUNCTION_LIMIT_FLAG}=`, ''));
// https://docs.digitalocean.com/products/functions/reference/build-process/

if (process.argv.includes('--help')) {
	console.log('This command takes the following optional commands:');
	console.log(`   ${BUILD_ONLY_FLAG}\t\t\tThis will only run the build step and not run any of the deploys`);
	console.log(`   ${DEPLOY_ONLY_FLAG}\t\tThis will only run the build step and not run any of the deploys`);
	console.log(`   ${FUNCTION_LIMIT_FLAG}=name_of_function\tOnly run the deploy for the specified functions (can be repeated). e.g. ${FUNCTION_LIMIT_FLAG}=hello/world`);
	process.exit(1);
}

const functionData = getData();

const BUILD_FOLDER = path.join(process.env.BUILD_TMP_DIR ?? './dist', 'aws-build');
const DEPLOY_FOLDER = path.join(process.env.BUILD_TMP_DIR ?? './dist', 'aws');
const DOCTL_PATH = `${process.env.DOCTL_HOME ? process.env.DOCTL_HOME + '/' : ''}doctl`;

// Create the required lib folder (empty)
const libPath = path.join(BUILD_FOLDER, 'lib');
if (!fs.existsSync(libPath)) {
	fs.mkdirSync(libPath, {recursive: true});
}

// https://github.com/archiverjs/node-archiver/issues/402#issuecomment-560169118
function walk(dir, topDir, excludePaths) {
	if (!topDir) {
		topDir = dir;
	}
	const files = fs.readdirSync(dir)
		.map(file => path.join(dir, file))
		.filter(filePath => !excludePaths?.includes(filePath))
		.map(filePath => {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) return walk(filePath, topDir, excludePaths);
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

function invokeAwsCommand(subcommand) {
	const cmd = `${DOCTL_PATH} ${subcommand}`;
	return invokeCommand(cmd);
}

function invokeAwsDeploy(path, extra = '') {
	return invokeAwsCommand(`serverless deploy ${path} ${extra}`)
			.then(r => console.log('  success:', r))
			.catch(e => console.log('  unable to deploy function', e));
}

// Hacky fix to get node_modules installed in prod mode.
// 1) move real folder
// 2) reinstall in prod mode
// 3) move that to a custom folder
// 4) move original back
async function prepNodeModules() {
	//TODO this will probably need to merge the node modules from the lib directory
	if (!fs.existsSync(BUILD_FOLDER)) {
		fs.mkdirSync(BUILD_FOLDER, {recursive: true});
	}
	const localLib = path.join(process.cwd(), 'lib');
	fs.cpSync(
		path.join(localLib, './package.json'),
		path.join(libPath, 'package.json'),
		{force: true}
	);
	await invokeCommand(`cd ${libPath} && npm install --omit=dev`);

	// copy lib files
	if (fs.existsSync(localLib)) {
		const libFiles = walk(
			localLib,
			null,
			['node_modules', 'package.json', 'package-lock.json', 'yarn.lock'].map(i => path.join(localLib, i))
		);
		console.log('lib files', libFiles);
		for (const entry of libFiles) {
			fs.cpSync(entry.fullPath, path.join(libPath, entry.relativePath));
		};
	}

	fs.writeFileSync(
		path.join(BUILD_FOLDER, 'package.json'),
		fs.readFileSync(path.join(process.cwd(), 'packages', './package.json'), 'utf8')
				.toString()
				.replace('"file:../lib"', '"file:./lib"')
	);
	// fs.cpSync(
	// 	path.join(process.cwd(), 'packages', './package.json'),
	// 	path.join(DEPLOY_FOLDER, 'package.json'),
	// 	{force: true}
	// );
	await invokeCommand(`cd ${BUILD_FOLDER} && npm install --omit=dev`);
}

//console.log(existingFunctions, existingPackages);
if (!isDeployOnly) {

	// Ensure that there is a node_modules.production folder
	await prepNodeModules();

	const awsPkgDir = path.dirname(fileURLToPath(import.meta.url));
	const projObj = {
		parameters: {},
		packages: []
	};

	// Build each function into a zip in the dist folder (nested appropriately)
	const functionsToBuild = functionsToDeploy.length ? functionData.functions.filter(f => functionsToDeploy.includes(`${f.packageName}/${f.functionName}`)) : functionData.functions;
	for (const func of functionsToBuild) {
		console.log(`package ${func.path}`);
		console.log('..assembling deploy');

		// Make sure that the package file is setup
		const funcRootPath = path.join(DEPLOY_FOLDER, 'packages', func.packageName, func.functionName);
		if (!fs.existsSync(funcRootPath)) {
			fs.mkdirSync(funcRootPath, {recursive: true});
		}

		/*
aws lambda create-function \
    --function-name my-function \
    --runtime nodejs22.x \
    --zip-file fileb://my-function.zip \
    --handler my-function.handler \
    --role arn:aws:iam::123456789012:role/service-role/MyTestFunction-role-tges6bf4
		*/

		/*
aws lambda update-function-code
		*/

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

			console.log('middleware', func.middleware);
			// Add wrapper files
			const mappedMiddleware = func.middleware
				.map(m => ({type: m.type, path: m.path, newPath: `middleware/${path.basename(m.path)}` }));
			mappedMiddleware.forEach(m => {
				// if (m.path.startsWith(localLib + '/')) return; //already copied
				zip.file(m.path, { name: m.newPath })
			});
			const authMiddleware = mappedMiddleware.filter(m => m.type === AUTHORIZATION_MW_TYPE);
			const otherMiddleware = mappedMiddleware.filter(m => m.type !== AUTHORIZATION_MW_TYPE);
			//TODO weirdly named files??
			zip.append(
				fs.readFileSync(path.join(awsPkgDir, 'aws-wrapper.mjs'), 'utf8')
					.toString()
					.replace(/const AUTH_MIDDLEWARE = \[\]/, `const AUTH_MIDDLEWARE = [${authMiddleware.map(a => `'./${a.newPath}'`).join(",")}]`)
					.replace(/const OTHER_MIDDLEWARE = \[\]/, `const OTHER_MIDDLEWARE = [${otherMiddleware.map(a => `'./${a.newPath}'`).join(",")}]`)
					.replace('ENTRYPOINT_FILE.mjs', path.basename(func.indexPath)),
				{name: 'index.mjs'}
			);
			zip.file(
				path.join(awsPkgDir, 'classes.mjs'),
				{name: 'classes.mjs'},
			);

			// Add all function files
			const funcFiles = walk(func.path);
			funcFiles
				.forEach(entry => {
					// console.log('adding file', func.path, entry.relativePath);
					zip.file(entry.fullPath, {name: `app/${entry.relativePath}`});
				});



			const zipNodeModules = (origin, dest, packageTransformer) => {
				const pkg = path.join(origin, 'package.json');
				const nm = path.join(origin, 'node_modules');
				if (fs.existsSync(pkg)) {
					if (packageTransformer) {
						zip.append(
							packageTransformer(fs.readFileSync(pkg, 'utf8').toString()),
							{name: `${dest}package.json`},
						);
					} else {
						zip.file(pkg, {name: `${dest}package.json`});
					}

					if (fs.existsSync(nm)) {
						let entries = walk(nm);
						// console.log('entries', entries);
						entries.forEach(entry => {
							// console.log(entry);
							zip.append(
								fs.createReadStream(entry.fullPath),
								{name: `${dest}node_modules/${entry.relativePath}`}
							);
						});
					}
				} else {
					const transformedPackage = packageTransformer?.();
					if (transformedPackage) {
						zip.append(
							transformedPackage,
							{name: `${dest}package.json`},
						);
					}
				}
			}

			// zipNodeModules(libPath, 'lib/');
			zipNodeModules(BUILD_FOLDER, '', (packageStr) => {
				console.log('transforming package.json');
				const packageObj = packageStr ? JSON.parse(packageStr) : {name: 'default-aws', version: '0.1'};
				return JSON.stringify({
					...packageObj,
					main: 'index.mjs',
					type: 'module'
				}, null, 2);
			});
			zipNodeModules(func.path, 'app/');
		});

	}

	// Write project file
	fs.writeFileSync(
		path.join(DEPLOY_FOLDER, 'project.yml'),
		yaml.stringify(projObj)
	);
}

if (!isBuildOnly && !functionsToDeploy.length) {
	// Invoke doctl command
	await invokeAwsDeploy(DEPLOY_FOLDER);
}

//https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-code.html#examples
//https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html
if (functionsToDeploy.length) {
	for (const func of functionsToDeploy) {
		await invokeAwsDeploy(DEPLOY_FOLDER, `--include ${func}`);
	}
}

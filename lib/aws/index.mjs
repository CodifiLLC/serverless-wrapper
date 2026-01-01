import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import path from 'path';
import archiver from 'archiver';
// import yaml from 'yaml';
import {getData, AUTHORIZATION_MW_TYPE} from "@serverless-wrapper/parser";
import pulumiAutomation from "@pulumi/pulumi/automation/index.js";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const BUILD_ONLY_FLAG = '--build-only';
const DEPLOY_ONLY_FLAG = '--deploy-only';

const isBuildOnly = process.argv.includes('--build-only');
const isDeployOnly = process.argv.includes('--deploy-only');
// https://docs.digitalocean.com/products/functions/reference/build-process/

if (process.argv.includes('--help')) {
	console.log('This command takes the following optional commands:');
	console.log(`   ${BUILD_ONLY_FLAG}\t\t\tThis will only run the build step and not run any of the deploys`);
	console.log(`   ${DEPLOY_ONLY_FLAG}\t\tThis will only run the build step and not run any of the deploys`);
	process.exit(1);
}

const functionData = getData();

const BUILD_FOLDER = path.join(process.env.BUILD_TMP_DIR ?? './dist', 'aws-build');
const DEPLOY_FOLDER = path.join(process.env.BUILD_TMP_DIR ?? './dist', 'aws');

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
	const cmd = `aws ${subcommand}`;
	return invokeCommand(cmd);
}

function invokeAwsDeploy(path, extra = '') {
	return invokeAwsCommand(`serverless deploy ${path} ${extra}`)
			.then(r => console.log('  success:', r))
			.catch(e => console.log('  unable to deploy function', e));
}

// Create a build folder for this project, copy the package.json files to it
// run the installs, and then copy those built folders into the zip
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

	const packagesPackageJson = path.join(process.cwd(), /*'packages',*/ './package.json');

	if (fs.existsSync(packagesPackageJson)) {
		fs.writeFileSync(
			path.join(BUILD_FOLDER, 'package.json'),
			fs.readFileSync(packagesPackageJson, 'utf8')
					.toString()
					.replace('"file:../lib"', '"file:./lib"')
		);
	}
	// fs.cpSync(
	// 	path.join(process.cwd(), 'packages', './package.json'),
	// 	path.join(DEPLOY_FOLDER, 'package.json'),
	// 	{force: true}
	// );
	await invokeCommand(`cd ${BUILD_FOLDER} && npm install --omit=dev`);
}


const runPulumiDeploy = async function ({environment}) {
    // This is our pulumi program in "inline function" form
    const pulumiProgram = async () => {
		const iamForLambda = new aws.iam.Role("iam_for_lambda", {
			name: "iam_for_lambda",
			assumeRolePolicy: JSON.stringify({
				Version: "2012-10-17",
				Statement: [{
					Action: "sts:AssumeRole",
					Effect: "Allow",
					Sid: "",
					Principal: {
						Service: "lambda.amazonaws.com",
					},
				}],
			}),
		});
		const lambdaFunc = new aws.lambda.Function("lambdaFunc", {
			runtime: "nodejs24.x",
			role: iamForLambda.arn,
			handler: "index.main",
			name: `serverlessWrapper${process.env.npm_package_name}Main`,
			code: new pulumi.asset.FileArchive(`./${DEPLOY_FOLDER}/deploy.zip`),
			environment: {
				variables: environment,
			}
		});
		const lambdaFuncUrl = new aws.lambda.FunctionUrl("serverless-url", {
			functionName: lambdaFunc.name,
			authorizationType: "NONE",
			cors: {
				allowCredentials: true,
				allowOrigins: ["*"],
				allowMethods: [
					"GET",
					"POST",
				],
				allowHeaders: [
					"date",
					"keep-alive",
				],
				exposeHeaders: [
					"keep-alive",
					"date",
				],
				maxAge: 86400,
			},
		});

		const url = lambdaFuncUrl.functionUrl;
	}

	// Create our stack
	//@type pulumiAutomation.InlineProgramArgs
    const args = {
        stackName: "dev",
        projectName: `serverless-wrapper-${process.env.npm_package_name}`,
        program: pulumiProgram
    };

    // create (or select if one already exists) a stack that uses our inline program
    const stack = await pulumiAutomation.LocalWorkspace.createOrSelectStack(args);

    console.info("successfully initialized stack");
    console.info("installing plugins...");
    await stack.workspace.installPlugin("aws", "v4.0.0");
    console.info("plugins installed");
    console.info("setting up config");
    // await stack.setConfig("aws:region", { value: "us-west-2" });
    console.info("config set");
    console.info("refreshing stack...");
    await stack.refresh({ onOutput: console.info });
    console.info("refresh complete");

    // if (destroy) {
    //     console.info("destroying stack...");
    //     await stack.destroy({ onOutput: console.info });
    //     console.info("stack destroy complete");
    //     process.exit(0);
    // }

    console.info("updating stack...");
    // const upRes = await stack.preview({ onOutput: console.info });
    const upRes = await stack.up({ onOutput: console.info });
    console.log(`update summary: \n${upRes.stdout}`);
    // console.log(`update summary: \n${JSON.stringify(upRes.stdout/*.resourceChanges*/, null, 4)}`);
    // console.log(`website url: ${upRes.outputs.websiteUrl.value}`);
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
	const functionsToBuild = functionData.functions;

	if (!fs.existsSync(DEPLOY_FOLDER)) {
		fs.mkdirSync(DEPLOY_FOLDER, {recursive: true});
	}

	const middlewareMap = {};
	const funcFileMap = {};

	for (const func of functionsToBuild) {
		console.log(`package ${func.path}`);
		console.log('..processing config');

		// Make sure that the package file is setup
		// const funcRootPath = path.join(DEPLOY_FOLDER, 'packages', func.packageName, func.functionName);
		// if (!fs.existsSync(funcRootPath)) {
		// 	fs.mkdirSync(funcRootPath, {recursive: true});
		// }

		/*
		aws lambda create-function \
			--function-name my-function \
			--runtime nodejs22.x \
			--zip-file fileb://my-function.zip \
			--handler my-function.handler \
			--role arn:aws:iam::123456789012:role/service-role/MyTestFunction-role-tges6bf4
		*/



		let packageObj = projObj.packages.find(p => p.name === func.packageName);
		if (!packageObj) {
			packageObj = {
				name: func.packageName,
				functions: []
			};
			projObj.packages.push(packageObj);
		}

		console.log('middleware', func.middleware);
		// Add wrapper files
		const mappedMiddleware = func.middleware
			.map(m => ({type: m.type, path: m.path, newPath: `middleware/${path.basename(m.path)}` }));
		mappedMiddleware.forEach(m => {
			// if (m.path.startsWith(localLib + '/')) return; //already copied
			middlewareMap[m.path] = m.newPath;
		});

		packageObj.functions.push({
			name: func.functionName,
			binary: false,
			path: `./app/${func.packageName}/${func.functionName}/${path.basename(func.indexPath)}`,
			// main: 'do-wrapper.mjs',
			authMiddleware: mappedMiddleware.filter(m => m.type === AUTHORIZATION_MW_TYPE).map(a => `./${a.newPath}`),
			otherMiddleware: mappedMiddleware.filter(m => m.type !== AUTHORIZATION_MW_TYPE).map(a => `./${a.newPath}`),
			// environment: Object.fromEntries(
			// 	Object.entries(func.envMap)
			// 		.map(([key, value]) => [key, value?.toString()])
			// ),
		});


		// Add all function files
		const funcFiles = walk(func.path);
		funcFiles
			.forEach(entry => {
				console.log('adding file:', `'${entry.fullPath}'`, func.path, entry.relativePath);
				funcFileMap[entry.fullPath] = `app/${func.packageName}/${func.functionName}/${path.basename(entry.relativePath)}`;
			});
		console.log(JSON.stringify(projObj, null, 2))
	}


	// Open the zip file, fill it with the following code, and then write it to disk
	await buildZip(DEPLOY_FOLDER, zip => {
		// Add wrapper files
		Object.keys(middlewareMap).forEach(file => {
			// if (m.path.startsWith(localLib + '/')) return; //already copied
			zip.file(file, { name: middlewareMap[file] })
		});
		Object.keys(funcFileMap).forEach(file => {
			zip.file(file, { name: funcFileMap[file] });
		})

		//TODO weirdly named files??
		zip.append(
			fs.readFileSync(path.join(awsPkgDir, 'aws-wrapper.mjs'), 'utf8')
				.toString()
				.replace('{ PATH: \'FUNCTION_CONFIG\' }', JSON.stringify(
					projObj.packages.map(p => p.functions.map(f => ({
						pattern: `/${p.name}/${f.name}`,
						...f
					}))).flat().reduce((agg, cur) => ({...agg, [cur.pattern]: cur}), {}),
					null,
					2
				)),
			{name: 'index.mjs'}
		);
		zip.file(
			path.join(awsPkgDir, 'classes.mjs'),
			{name: 'classes.mjs'},
		);




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
		// zipNodeModules(func.path, 'app/');
	});

	await runPulumiDeploy({environment: functionData.envMap});

	// Write project file
	// fs.writeFileSync(
	// 	path.join(DEPLOY_FOLDER, 'project.yml'),
	// 	yaml.stringify(projObj)
	// );
}

// if (!isBuildOnly && !functionsToDeploy.length) {
// 	// Invoke doctl command
// 	await invokeAwsDeploy(DEPLOY_FOLDER);
// }

// //https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-code.html#examples
// //https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html
// if (functionsToDeploy.length) {
// 	for (const func of functionsToDeploy) {
// 		await invokeAwsDeploy(DEPLOY_FOLDER, `--include ${func}`);
// 	}
// }

const cfFunc = (funcname, path, env) => ({
  "Type" : "AWS::Lambda::Function",
  "Properties" : {
    //   "Architectures" : [ ],
      "Code" : {
		Zip: {
			S3Bucket: '',
			S3Key: '',
			S3ObjectVersion: ''
		}
	  },
    //   "CodeSigningConfigArn" : String,
    //   "DeadLetterConfig" : DeadLetterConfig,
      "Description" : `Function to handle ${path}`,
      "Environment" : env,
      "FunctionName" : funcname,
    //   "FunctionScalingConfig" : FunctionScalingConfig,
      "Handler" : 'index.main',
    //   "LoggingConfig" : LoggingConfig,
    //   "MemorySize" : Integer,
      "PackageType" : 'Zip',
    //   "PublishToLatestPublished" : Boolean,
    //   "RecursiveLoop" : String,
    //   "ReservedConcurrentExecutions" : Integer,
      "Role" : String,
      "Runtime" : 'nodejs',
    //   "Tags" : [ Tag, ... ],
    //   "TenancyConfig" : TenancyConfig,
    //   "Timeout" : Integer,
    //   "VpcConfig" : VpcConfig
    }
});

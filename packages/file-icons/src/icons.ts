/**
 * The Material icon subset the UI bundles. Static imports on purpose: a glob
 * over the pack's 1250 SVGs would ship megabytes for the handful we show.
 */
import bunIcon from 'material-icon-theme/icons/bun.svg?raw';
import cIcon from 'material-icon-theme/icons/c.svg?raw';
import certificateIcon from 'material-icon-theme/icons/certificate.svg?raw';
import consoleIcon from 'material-icon-theme/icons/console.svg?raw';
import cppIcon from 'material-icon-theme/icons/cpp.svg?raw';
import cssIcon from 'material-icon-theme/icons/css.svg?raw';
import databaseIcon from 'material-icon-theme/icons/database.svg?raw';
import dockerIcon from 'material-icon-theme/icons/docker.svg?raw';
import documentIcon from 'material-icon-theme/icons/document.svg?raw';
import fileIcon from 'material-icon-theme/icons/file.svg?raw';
import folderIcon from 'material-icon-theme/icons/folder.svg?raw';
import gitIcon from 'material-icon-theme/icons/git.svg?raw';
import goIcon from 'material-icon-theme/icons/go.svg?raw';
import htmlIcon from 'material-icon-theme/icons/html.svg?raw';
import imageIcon from 'material-icon-theme/icons/image.svg?raw';
import javaIcon from 'material-icon-theme/icons/java.svg?raw';
import javascriptIcon from 'material-icon-theme/icons/javascript.svg?raw';
import jsonIcon from 'material-icon-theme/icons/json.svg?raw';
import lockIcon from 'material-icon-theme/icons/lock.svg?raw';
import markdownIcon from 'material-icon-theme/icons/markdown.svg?raw';
import nodejsIcon from 'material-icon-theme/icons/nodejs.svg?raw';
import pdfIcon from 'material-icon-theme/icons/pdf.svg?raw';
import pythonIcon from 'material-icon-theme/icons/python.svg?raw';
import reactIcon from 'material-icon-theme/icons/react.svg?raw';
import reactTsIcon from 'material-icon-theme/icons/react_ts.svg?raw';
import readmeIcon from 'material-icon-theme/icons/readme.svg?raw';
import rubyIcon from 'material-icon-theme/icons/ruby.svg?raw';
import rustIcon from 'material-icon-theme/icons/rust.svg?raw';
import sassIcon from 'material-icon-theme/icons/sass.svg?raw';
import svelteIcon from 'material-icon-theme/icons/svelte.svg?raw';
import svgIcon from 'material-icon-theme/icons/svg.svg?raw';
import tomlIcon from 'material-icon-theme/icons/toml.svg?raw';
import tsconfigIcon from 'material-icon-theme/icons/tsconfig.svg?raw';
import tuneIcon from 'material-icon-theme/icons/tune.svg?raw';
import typescriptIcon from 'material-icon-theme/icons/typescript.svg?raw';
import vueIcon from 'material-icon-theme/icons/vue.svg?raw';
import yamlIcon from 'material-icon-theme/icons/yaml.svg?raw';

export const fileIcons: Record<string, string> = {
	bun: bunIcon,
	c: cIcon,
	certificate: certificateIcon,
	console: consoleIcon,
	cpp: cppIcon,
	css: cssIcon,
	database: databaseIcon,
	docker: dockerIcon,
	document: documentIcon,
	file: fileIcon,
	folder: folderIcon,
	git: gitIcon,
	go: goIcon,
	html: htmlIcon,
	image: imageIcon,
	java: javaIcon,
	javascript: javascriptIcon,
	json: jsonIcon,
	lock: lockIcon,
	markdown: markdownIcon,
	nodejs: nodejsIcon,
	pdf: pdfIcon,
	python: pythonIcon,
	react: reactIcon,
	react_ts: reactTsIcon,
	readme: readmeIcon,
	ruby: rubyIcon,
	rust: rustIcon,
	sass: sassIcon,
	svelte: svelteIcon,
	svg: svgIcon,
	toml: tomlIcon,
	tsconfig: tsconfigIcon,
	tune: tuneIcon,
	typescript: typescriptIcon,
	vue: vueIcon,
	yaml: yamlIcon,
};

import {
	ACESFilmicToneMapping,
	Box3,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer,
	type BufferGeometry,
	type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { orbitCameraPosition, type ModelFormat, type ModelOrbit } from './model';

const FIELD_OF_VIEW = 32;

/**
 * A browser allows only a handful of live WebGL contexts per page, so every model
 * on the board renders through one renderer and copies the result into its own 2D
 * canvas. The board itself is Pixi's context; this is the only other one.
 */
let sharedRenderer: WebGLRenderer | null = null;
let sharedUsers = 0;
let sharedSize = { width: 0, height: 0, resolution: 0 };

function acquireRenderer(): WebGLRenderer {
	sharedUsers += 1;
	if (sharedRenderer) return sharedRenderer;

	sharedRenderer = new WebGLRenderer({
		alpha: true,
		antialias: true,
		// The result is read back with `drawImage`, never composited by the page.
		preserveDrawingBuffer: true,
	});
	sharedRenderer.setClearColor(0x000000, 0);
	sharedRenderer.toneMapping = ACESFilmicToneMapping;
	sharedSize = { width: 0, height: 0, resolution: 0 };
	return sharedRenderer;
}

function releaseRenderer(): void {
	sharedUsers -= 1;
	if (sharedUsers > 0 || !sharedRenderer) return;
	sharedRenderer.dispose();
	sharedRenderer.forceContextLoss();
	sharedRenderer = null;
	sharedUsers = 0;
}

/** What a format that carries no materials of its own is drawn with. */
function defaultMaterial(): MeshStandardMaterial {
	return new MeshStandardMaterial({ color: 0xb9b9c4, roughness: 0.5, metalness: 0.05 });
}

function disposeTree(root: Object3D): void {
	const disposeMaterial = (material: Material) => {
		// A material's textures are GPU memory it does not own and does not free.
		for (const value of Object.values(material)) {
			const texture = value as { isTexture?: boolean; dispose?: () => void } | null;
			if (texture?.isTexture) texture.dispose?.();
		}
		material.dispose();
	};

	root.traverse((node) => {
		const mesh = node as Partial<Mesh>;
		(mesh.geometry as BufferGeometry | undefined)?.dispose();
		const material = mesh.material as Material | Material[] | undefined;
		if (Array.isArray(material)) for (const entry of material) disposeMaterial(entry);
		else if (material) disposeMaterial(material);
	});
}

/**
 * One model, its lights and its camera, drawn into an offscreen canvas the board
 * wraps in a texture. Nothing here runs on a ticker: the owner renders a frame
 * only when something it can see actually changed.
 */
export class ModelScene {
	readonly canvas = document.createElement('canvas');

	private readonly context = this.canvas.getContext('2d');
	private readonly scene = new Scene();
	private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 100);
	private readonly renderer = acquireRenderer();
	private model: Object3D | null = null;
	private width = 1;
	private height = 1;
	private resolution = 1;

	constructor() {
		const key = new DirectionalLight(0xffffff, 2.6);
		key.position.set(2.5, 3.5, 2);
		const fill = new DirectionalLight(0xffffff, 1.1);
		fill.position.set(-3, 0.5, -2.5);
		this.scene.add(new HemisphereLight(0xffffff, 0x2a2a33, 1.8), key, fill);
	}

	get loaded(): boolean {
		return this.model !== null;
	}

	/**
	 * Fetched and parsed in the browser rather than through three's own loader
	 * manager, so the asset route's bytes are read once and the format the board
	 * recorded decides the parser instead of the url's extension.
	 */
	async load(url: string, format: ModelFormat): Promise<boolean> {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`the asset route answered ${response.status}`);
		const buffer = await response.arrayBuffer();

		let object: Object3D;
		if (format === 'glb' || format === 'gltf') {
			object = (await new GLTFLoader().parseAsync(buffer, '')).scene;
		} else if (format === 'stl') {
			const geometry = new STLLoader().parse(buffer);
			if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
			object = new Mesh(geometry, defaultMaterial());
		} else if (format === 'obj') {
			object = new OBJLoader().parse(new TextDecoder().decode(buffer));
			// The `mtllib` an obj names is a second file the board never received, so
			// every mesh is given the same material a bare stl gets.
			object.traverse((node) => {
				const mesh = node as Mesh;
				if (!mesh.isMesh) return;
				if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
				mesh.material = defaultMaterial();
			});
		} else {
			return false;
		}

		// Normalised to a unit radius around the origin so the orbit distance means
		// the same thing whether the file is in millimetres or in metres.
		const box = new Box3().setFromObject(object);
		// An empty box is a file that parsed into no drawable geometry — an obj of
		// nothing but lines, or one whose faces the parser could not resolve.
		if (box.isEmpty() || !Number.isFinite(box.min.x)) throw new Error('the file carries no drawable geometry');
		const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1e-6);
		const centre = box.getCenter(new Vector3()).multiplyScalar(1 / radius);
		object.scale.setScalar(1 / radius);
		object.position.set(-centre.x, -centre.y, -centre.z);

		this.clearModel();
		this.model = object;
		this.scene.add(object);
		return true;
	}

	/** `width`/`height` are board units; `resolution` is the device pixels per unit. */
	resize(width: number, height: number, resolution: number): void {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.resolution = Math.max(1, resolution);
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();

		// Assigning either dimension clears the drawing buffer, so the canvas is only
		// re-sized when it is actually out of step with what the next frame will draw.
		const pixelWidth = Math.round(this.width * this.resolution);
		const pixelHeight = Math.round(this.height * this.resolution);
		if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
		if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
	}

	render(orbit: ModelOrbit): void {
		if (!this.model || !this.context) return;

		const position = orbitCameraPosition(orbit);
		this.camera.position.set(position.x, position.y, position.z);
		this.camera.lookAt(0, 0, 0);

		// Assigning a canvas size resets its drawing buffer, so the shared renderer
		// is only re-sized when this model's box differs from the last one drawn.
		const changed =
			sharedSize.width !== this.width || sharedSize.height !== this.height || sharedSize.resolution !== this.resolution;
		if (changed) {
			this.renderer.setPixelRatio(this.resolution);
			this.renderer.setSize(this.width, this.height, false);
			sharedSize = { width: this.width, height: this.height, resolution: this.resolution };
		}

		this.renderer.render(this.scene, this.camera);
		this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.context.drawImage(this.renderer.domElement, 0, 0, this.canvas.width, this.canvas.height);
	}

	dispose(): void {
		this.clearModel();
		releaseRenderer();
	}

	private clearModel(): void {
		if (!this.model) return;
		this.scene.remove(this.model);
		disposeTree(this.model);
		this.model = null;
	}
}

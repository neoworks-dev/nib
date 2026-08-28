import type { Plugin } from '@nib-ui/kernel';
import { assetPath, readAsset, storeAsset, type StoreAssetOptions, type StoredAsset } from '../asset-store';
import { assetsDirectory } from '../data-dir';
import type { AssetService } from '../services';

class AssetStore implements AssetService {
	constructor(private readonly directory: string) {}

	store(bytes: Uint8Array, options?: StoreAssetOptions): Promise<StoredAsset> {
		return storeAsset(this.directory, bytes, options);
	}

	read(assetId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
		return readAsset(this.directory, assetId);
	}

	path(assetId: string): Promise<string | null> {
		return assetPath(this.directory, assetId);
	}
}

export const assetsPlugin: Plugin = {
	name: 'assets',
	apply(ctx) {
		ctx.provide('assets', new AssetStore(assetsDirectory()));
	},
};

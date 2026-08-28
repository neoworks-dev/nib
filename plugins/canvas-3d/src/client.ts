import { storeWorkspaceAsset, uploadAsset, type WorkspaceAsset } from '@nib-ui/plugin-canvas-media';
import { modelFormatForContentType, sniffModelFormat, type ModelFormat } from './model';

export { storeWorkspaceAsset, type WorkspaceAsset };

export interface UploadedModel {
	assetId: string;
	format: ModelFormat;
	name: string;
}

export async function uploadModel(file: File): Promise<UploadedModel | null> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const declared = sniffModelFormat(file.name, bytes) ?? modelFormatForContentType(file.type);
	if (!declared) return null;

	const asset = await uploadAsset(file);
	// The server sniffs the bytes, and that verdict wins over the file's own claim.
	return { assetId: asset.assetId, format: modelFormatForContentType(asset.contentType) ?? declared, name: file.name };
}


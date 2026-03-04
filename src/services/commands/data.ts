import { invokeCommand } from './invoke';

import type { ExportResult } from '../../types/domain';

export function dataExportJson(): Promise<ExportResult> {
  return invokeCommand<ExportResult>('data_export_json');
}

export function dataExportToFile(path: string): Promise<ExportResult> {
  return invokeCommand<ExportResult>('data_export_to_file', { path });
}

export function dataImportFromFile(path: string): Promise<string> {
  return invokeCommand<string>('data_import_from_file', { path });
}

export function dataClearAll(): Promise<void> {
  return invokeCommand<void>('data_clear_all');
}

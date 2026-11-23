// TURN-076. Download the model as an IO-list CSV. The click does not edit the project.
import { ioListFileName, renderIoListCsv } from '../import/ioList';
import type { Project } from '../model/types';
import { IconLabel } from './Icon';

export function IoListExportButton({ p, onDownload }: {
  p: Project;
  onDownload?: (name: string, text: string, mime?: string) => void;
}) {
  return (
    <button
      type="button"
      data-io-export=""
      title="모델은 바꾸지 않습니다"
      onClick={() => onDownload?.(ioListFileName(p.name), renderIoListCsv(p), 'text/csv;charset=utf-8')}
    >
      <IconLabel id="export-json">IO 리스트 내보내기 (CSV)</IconLabel>
    </button>
  );
}

// Sample IO list for TURN-060. A subset of the 5-step example, plus one new unit and one unknown kind.
import { writeFileSync } from 'node:fs';
import { buildXlsx } from '../src/import/xlsxWrite';

const header = ['Unit', 'Device', 'Type', 'Signal', 'Direction', 'Address', 'Memo'];
const rows = [
  ['S1 투입', 'PSH-01', '푸셔', '푸시 명령', '출력', 'Y100', '5공정 예제'],
  ['S1 투입', 'CYL-01', '실린더', '전진 명령', '출력', 'Y101', ''],
  ['S1 투입', 'CYL-01', 'Cylinder', '전진 완료', '입력', 'X101', '같은 장치'],
  ['S2 식별', 'BCR-02', '바코드리더', '읽기 완료', '입력', 'X200', ''],
  ['S6 검사', 'SEN-06', '센서', '감지', '입력', 'X600', '새 유닛'],
  ['S6 검사', 'SEN-06', '센서', '예비 신호', '출력', 'Y600', '정의에 없는 신호'],
  ['S6 검사', 'CYL-06', 'Cylinder', '전진 명령', '출력', 'Y610', '영문 종류'],
  ['S6 검사', 'ARM-06', '로봇', '동작', '출력', 'Y601', '종류 미지정'],
];

const bytes = buildXlsx([
  { name: 'IO', rows: [header, ...rows] },
  { name: '참고', rows: [['메모'], ['이 파일은 5공정 예제의 일부입니다. 시간·주소는 가정값입니다.']] },
]);
writeFileSync(new URL('../docs/samples/io-list-5step.xlsx', import.meta.url), bytes);
console.log(`docs/samples/io-list-5step.xlsx (${bytes.byteLength} bytes)`);

// Generates sample project files (requires assets/aml/ecd-sample-library.aml). Run: npm run gen:samples
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { serializeProject } from '../src/storage/fileFormat';
import { BUNDLED_AML_TEXT } from '../src/assets/library';

mkdirSync('samples', { recursive: true });
const good = serializeProject(buildSampleProject());
writeFileSync('samples/sample-5step.ecd.json', good);
writeFileSync('samples/sample-parallel-substation.ecd.json', serializeProject(buildParallelSampleProject()));
writeFileSync('samples/invalid-corrupt.ecd.json', good.slice(0, 400));
const v = JSON.parse(good); v.formatVersion = '9.0.0';
writeFileSync('samples/invalid-unsupported-version.ecd.json', JSON.stringify(v, null, 2));
const m = JSON.parse(good); m.project.sequence.steps[2].actionId = 'ghost-action-999';
writeFileSync('samples/invalid-missing-reference.ecd.json', JSON.stringify(m, null, 2));
// AML negative samples (for import diagnostics)
mkdirSync('samples/aml', { recursive: true });
writeFileSync('samples/aml/invalid-syntax.aml', BUNDLED_AML_TEXT.slice(0, 600));
writeFileSync('samples/aml/unsupported-schema-2.15.aml', BUNDLED_AML_TEXT.replace('SchemaVersion="3.0"', 'SchemaVersion="2.15"'));
writeFileSync('samples/aml/missing-child-ref.aml', BUNDLED_AML_TEXT.replace('RefBaseSystemUnitPath="ECD_SampleAssetLib/pusher"', 'RefBaseSystemUnitPath="ECD_SampleAssetLib/ghostPusher"'));
writeFileSync('samples/aml/extra-asset-vacuumGripper.aml', extraAml());
console.log('wrote 5 project samples and 4 AML samples');

function extraAml() {
  // a small external library (one new device) to demonstrate import of AML not bundled with the app
  return `<?xml version="1.0" encoding="UTF-8"?>
<CAEXFile xmlns="http://www.dke.de/CAEX" SchemaVersion="3.0" FileName="extra-asset-vacuumGripper.aml">
  <SuperiorStandardVersion>AutomationML 2.10</SuperiorStandardVersion>
  <SourceDocumentInformation OriginName="hand-written sample" OriginID="ecd-sample-extra" OriginVersion="0.1" LastWritingDateTime="2026-11-08T00:00:00Z" />
  <InterfaceClassLib Name="ECD_InterfaceClassLib">
    <Version>0.1.0</Version>
    <InterfaceClass Name="ConceptSignal" />
  </InterfaceClassLib>
  <RoleClassLib Name="ECD_RoleClassLib">
    <Version>0.1.0</Version>
    <RoleClass Name="AxisDevice" />
  </RoleClassLib>
  <SystemUnitClassLib Name="ECD_ExtraLib">
    <Version>0.1.0</Version>
    <SystemUnitClass Name="vacuumGripper" ID="asset.extra.vacuumGripper">
      <Description>진공 그리퍼 (가져온 AML 예시)</Description>
      <Version>0.1.0</Version>
      <Attribute Name="suctionTime" AttributeDataType="xs:double" Unit="s"><Description>흡착 시간</Description><DefaultValue>0.4</DefaultValue>
        <Attribute Name="ECD.requiredForRun" AttributeDataType="xs:boolean"><Value>true</Value></Attribute></Attribute>
      <Attribute Name="ECD.AppExtension">
        <Attribute Name="Category"><Value>axis</Value></Attribute>
        <Attribute Name="NamePrefix"><Value>VAC</Value></Attribute>
        <Attribute Name="Actions">
          <Attribute Name="suck">
            <Attribute Name="Label"><Value>흡착</Value></Attribute><Attribute Name="Kind"><Value>pick</Value></Attribute>
            <Attribute Name="CommandPort"><Value>cmdVac</Value></Attribute><Attribute Name="CompletePort"><Value>vacOk</Value></Attribute>
            <Attribute Name="DurationS" Unit="s"><Value>0.4</Value></Attribute><Attribute Name="TimeoutS" Unit="s"><Value>2</Value></Attribute>
          </Attribute>
        </Attribute>
      </Attribute>
      <ExternalInterface Name="cmdVac" ID="asset.extra.vacuumGripper.cmdVac" RefBaseClassPath="ECD_InterfaceClassLib/ConceptSignal">
        <Attribute Name="Direction"><Value>in</Value></Attribute><Attribute Name="SignalRole"><Value>command</Value></Attribute><Attribute Name="ValueType"><Value>xs:boolean</Value></Attribute>
      </ExternalInterface>
      <ExternalInterface Name="vacOk" ID="asset.extra.vacuumGripper.vacOk" RefBaseClassPath="ECD_InterfaceClassLib/ConceptSignal">
        <Attribute Name="Direction"><Value>out</Value></Attribute><Attribute Name="SignalRole"><Value>complete</Value></Attribute><Attribute Name="ValueType"><Value>xs:boolean</Value></Attribute>
      </ExternalInterface>
      <SupportedRoleClass RefRoleClassPath="ECD_RoleClassLib/AxisDevice" />
    </SystemUnitClass>
  </SystemUnitClassLib>
</CAEXFile>
`;
}

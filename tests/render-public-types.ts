import type {
  TerrainMapProps,
  TerrainWireGridInput,
} from '../UI/render/index.js'

type IsAny<Value> = 0 extends (1 & Value) ? true : false
type AssertFalse<Value extends false> = Value
type AssertTrue<Value extends true> = Value
type TerrainMapPropsIsTyped = AssertFalse<IsAny<TerrainMapProps>>
type TerrainWireGridInputIsTyped = AssertFalse<IsAny<TerrainWireGridInput>>
type TerrainMapPropsHasData = AssertTrue<TerrainMapProps extends { data: readonly number[] } ? true : false>
type TerrainWireGridInputHasGrid = AssertTrue<TerrainWireGridInput extends {
  data: readonly number[]
  gridRows: number
  gridColumns: number
} ? true : false>

const props: TerrainMapProps = {
  data: new Array(1024).fill(0),
  rows: 32,
  columns: 32,
}

const wireInput: TerrainWireGridInput = {
  data: props.data,
  dataRows: 32,
  dataColumns: 32,
  gridRows: 32,
  gridColumns: 32,
  maxValue: 255,
  gain: 1,
  heightScale: 4.8,
}

void props
void wireInput
void (null as unknown as TerrainMapPropsIsTyped)
void (null as unknown as TerrainWireGridInputIsTyped)
void (null as unknown as TerrainMapPropsHasData)
void (null as unknown as TerrainWireGridInputHasGrid)

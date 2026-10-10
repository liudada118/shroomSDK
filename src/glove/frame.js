const { mapFullPacketPressure, mapFullPacketTo1024 } = require('./fullPacketMapping');
const { mapHand147To1024, mapHand256To147 } = require('./mapping');

function mapGlovePressure(pressureData, side, product = {}) {
  if (product.protocol === 'fixed-274') {
    return {
      mappedData: mapFullPacketPressure(pressureData, side),
      matrixData: mapFullPacketTo1024(pressureData, side),
    };
  }

  const mappedData = mapHand256To147(pressureData, side);
  return {
    mappedData,
    matrixData: mapHand147To1024(mappedData),
  };
}

function remapGloveFrame(frame) {
  if (!frame?.handSide || !Array.isArray(frame.pressureData)) return frame;
  const mapping = mapGlovePressure(frame.pressureData, frame.handSide, frame.product);
  return {
    ...frame,
    ...mapping,
    pressure: {
      ...frame.pressure,
      values: frame.pressureData,
    },
  };
}

module.exports = {
  mapGlovePressure,
  remapGloveFrame,
};

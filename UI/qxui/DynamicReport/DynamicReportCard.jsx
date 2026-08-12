import React, { forwardRef } from 'react';
import { observer } from 'mobx-react';
import { Tooltip } from 'antd';
import ComparePlay from './ComparePlay.jsx';
import { Card, Title } from './DynamicReportCard.styles.jsx';

const DynamicReportCard = forwardRef((props, ref) => {
  const { chair, heatmapWidth, HeatmapComponent } = props;
  const title = chair?.name || '';

  return (
    <>
      <Tooltip title={title}>
        <Title>{title}</Title>
      </Tooltip>
      <Card hoverable>
        <ComparePlay
          ref={ref}
          width={heatmapWidth}
          chair={chair}
          HeatmapComponent={HeatmapComponent}
        />
      </Card>
    </>
  );
});

DynamicReportCard.displayName = 'DynamicReportCard';

export default observer(DynamicReportCard);

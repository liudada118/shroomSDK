import React, { Component, forwardRef } from 'react';
import { observer } from 'mobx-react';
import { useTranslation } from 'react-i18next';
import PlaybackControls from './PlaybackControls.jsx';
import ReportMetrics from './ReportMetrics.jsx';
import { Container, Main } from './ComparePlay.styles.jsx';

const DefaultHeatmap = forwardRef((props, ref) => {
  const values = Array.isArray(props.data) ? props.data : [];
  const size = Math.max(1, Math.ceil(Math.sqrt(values.length || 1)));
  const max = Math.max(...values.map(Number).filter(Number.isFinite), 1);

  return (
    <div
      ref={ref}
      style={{
        width: props.width || '100%',
        height: props.height || '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${size}, 1fr)`,
        gridAutoRows: '1fr',
        gap: 1,
        background: '#f1f5f9',
        overflow: 'hidden',
      }}
    >
      {values.map((value, index) => {
        const ratio = Math.max(0, Math.min(1, Number(value) / max || 0));
        const alpha = 0.08 + ratio * 0.72;

        return (
          <span
            key={index}
            style={{ background: `rgba(0, 114, 239, ${alpha})` }}
          />
        );
      })}
    </div>
  );
});

DefaultHeatmap.displayName = 'DefaultHeatmap';

// Avoid repainting the whole heatmap when the data reference is unchanged.
export class NoRender extends Component {
  shouldComponentUpdate(nextProps) {
    if (Object.prototype.hasOwnProperty.call(this.props, 'data')) {
      return nextProps.data !== this.props.data;
    }

    return false;
  }

  render() {
    return this.props.children;
  }
}

const ComparePlay = forwardRef((props, ref) => {
  const { t } = useTranslation();
  const { chair, HeatmapComponent = DefaultHeatmap } = props;

  const handlePlay = () => {
    chair?.startPlay?.();
  };

  const handlePause = () => {
    chair?.pausePlay?.();
  };

  const handleChangePlaySpeed = (speed) => {
    chair?.setPlaySpeed?.(speed);
  };

  const handleChangeProgress = (percent) => {
    const offset = (chair?.dataLength || 0) * percent / 100;
    chair?.setOffset?.(offset);

    if (chair?.paused || !chair?.playing) {
      chair?.startPlay?.();
    }
  };

  return (
    <Container>
      <Main>
        <NoRender data={chair?.frameData}>
          <HeatmapComponent
            ref={ref}
            width="100%"
            childWidth={props.width}
            height="100%"
            data={chair?.frameData || []}
          />
        </NoRender>
      </Main>
      <ReportMetrics
        items={[
          {
            key: 'pressure',
            label: t('pressure_release_average'),
            value: chair?.frameQueue?.meanPressureStr || '--',
            unit: 'PA',
          },
          {
            key: 'area',
            label: t('pressure_cont_area_average'),
            value: chair?.frameQueue?.meanAreaStr || '--',
            unit: 'CM2',
          },
          {
            key: 'contact-pressure',
            label: t('perUnitArea'),
            value: chair?.frameQueue?.meanContactPressureStr || '--',
            unit: 'PA',
          },
        ]}
      />
      <PlaybackControls
        durationTime={chair?.durationTime}
        isPlaying={chair?.playing && !chair?.paused}
        onChangeProgress={handleChangeProgress}
        onChangeSpeed={handleChangePlaySpeed}
        onPause={handlePause}
        onPlay={handlePlay}
        playSpeed={chair?.playSpeed}
        progress={chair?.progress}
        progressTime={chair?.progressTime}
        speedLabel={t('play_speed')}
      />
    </Container>
  );
});

ComparePlay.displayName = 'ComparePlay';

export default observer(ComparePlay);

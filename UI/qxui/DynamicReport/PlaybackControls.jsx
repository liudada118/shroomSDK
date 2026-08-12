import React from 'react';
import { Dropdown, Slider } from 'antd';
import { CaretRightOutlined, PauseOutlined } from '@ant-design/icons';
import {
  Container,
  Control,
  ControlRow,
  PlayButton,
  SpeedText,
} from './PlaybackControls.styles.jsx';

export default function PlaybackControls(props) {
  const {
    durationTime,
    isPlaying,
    onChangeProgress,
    onChangeSpeed,
    onPause,
    onPlay,
    playSpeed,
    playSpeeds = [0.5, 1, 1.5, 2],
    progress,
    progressTime,
    speedLabel,
  } = props;

  const items = playSpeeds.map((speed) => ({
    key: String(speed),
    label: <SpeedText>{speed}x</SpeedText>,
  }));

  return (
    <Container>
      <PlayButton>
        {isPlaying
          ? <PauseOutlined onClick={onPause} />
          : <CaretRightOutlined onClick={onPlay} />}
      </PlayButton>
      <Control>
        <ControlRow>
          <div>{`${progressTime || '00:00'}/${durationTime || '00:00'}`}</div>
          <Dropdown
            menu={{
              items,
              selectable: true,
              selectedKeys: [String(playSpeed || 1)],
              onClick: ({ key }) => onChangeSpeed?.(Number(key)),
            }}
            placement="top"
          >
            <span>{speedLabel}</span>
          </Dropdown>
        </ControlRow>
        <Slider
          max={100}
          min={0}
          onChange={onChangeProgress}
          step={1}
          value={progress || 0}
        />
      </Control>
    </Container>
  );
}

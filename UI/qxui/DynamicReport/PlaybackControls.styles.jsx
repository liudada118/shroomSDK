import { styled } from 'styled-components';

export const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
`;

export const Control = styled.div`
  flex: 1;
`;

export const ControlRow = styled.div`
  display: flex;
  justify-content: space-between;
`;

export const PlayButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 28px;
  color: rgba(0, 114, 239, 0.5);
  transition: 0.5s;
  cursor: pointer;

  &:hover {
    color: rgba(0, 114, 239, 1);
  }
`;

export const SpeedText = styled.span`
  ${props => props['data-active'] && `
    color: #0072ef;
  `}
`;

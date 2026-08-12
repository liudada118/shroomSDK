import { styled } from 'styled-components';
import { Card as AntCard } from 'antd';

export const Title = styled.div`
  font-size: 20px;
  font-weight: bold;
  text-align: center;
  padding-bottom: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Card = styled(AntCard)`
  flex: 1;
  display: flex;
  flex-direction: column;

  .ant-card-body {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
`;

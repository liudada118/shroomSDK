import { styled } from 'styled-components';

export const Container = styled.ul`
  margin: 0;
  padding: 0;
  font-size: 16px;
  list-style: none;
`;

export const Metric = styled.li`
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid #ecf0f4;

  &:first-child {
    border-top: none;
  }
`;

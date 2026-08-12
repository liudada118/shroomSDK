import React from 'react';
import { Container, Metric } from './ReportMetrics.styles.jsx';

export default function ReportMetrics({ items = [] }) {
  return (
    <Container>
      {items.map(({ key, label, value, unit }) => (
        <Metric key={key || label}>
          <span>{label}</span>
          <span>{value ?? '--'}{unit}</span>
        </Metric>
      ))}
    </Container>
  );
}

import writeXlsxFile from 'write-excel-file/browser';

const HEADER_STYLE = {
  backgroundColor: '#5C4B73',
  textColor: '#FFFFFF',
  fontWeight: 'bold',
  align: 'center',
  alignVertical: 'center',
  wrap: true,
  height: 30,
  borderColor: '#E4DBCD',
  borderStyle: 'thin'
};

const CELL_STYLE = {
  alignVertical: 'center',
  wrap: true,
  borderColor: '#E9E2D8',
  bottomBorderStyle: 'thin'
};

export async function exportExcel(headers, rows, filename, options = {}) {
  const moneyColumns = new Set(options.moneyColumns || []);
  const integerColumns = new Set(options.integerColumns || []);
  const data = [
    headers.map(value => ({ value, type: String, ...HEADER_STYLE })),
    ...rows.map(row => row.map((rawValue, columnIndex) => {
      const value = rawValue == null ? '' : rawValue;
      const isNumber = typeof value === 'number' && Number.isFinite(value);
      return {
        value,
        type: isNumber ? Number : String,
        ...(moneyColumns.has(columnIndex) ? { format: '¥#,##0.00', align: 'right' } : {}),
        ...(integerColumns.has(columnIndex) ? { format: '0', align: 'right' } : {}),
        ...CELL_STYLE
      };
    }))
  ];

  const output = writeXlsxFile(data, {
    sheet: options.sheet || '销售明细',
    columns: (options.widths || headers.map(() => 14)).map(width => ({ width })),
    stickyRowsCount: 1,
    orientation: 'landscape',
    showGridLines: false,
    zoomScale: 0.85
  }, {
    fontFamily: 'Microsoft YaHei',
    fontSize: 11
  });
  await output.toFile(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

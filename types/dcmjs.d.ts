declare module 'dcmjs' {
  const dcmjs: {
    data: {
      DicomDict: new (meta: Record<string, unknown>) => {dict: Record<string, unknown>; write(): ArrayBuffer};
      DicomMetaDictionary: {denaturalizeDataset(dataset: Record<string, unknown>): Record<string, unknown>};
    };
  };
  export default dcmjs;
}

type SourceSeries = { id: string; studyId: string; imageIds: string[]; mediaSession?: string; archived?: boolean };

/** All series of the active study; never include another patient's open study. */
export function reportHandoff<T extends SourceSeries>(series: T[], selectedId?: string) {
  const selected = series.find(item => item.id === selectedId);
  const included = selected ? series.filter(item => selected.studyId ? item.studyId === selected.studyId : item.id === selected.id) : [];
  return {
    imageIds: [...new Set(included.flatMap(item => item.imageIds))],
    preferredSeriesId: selected?.id.replace(/^media:[^:]+:/, ''),
    mediaSessions: [...new Set(included.filter(item => !item.archived && item.mediaSession).map(item => item.mediaSession!))],
  };
}

export function buildContentPath({ id, type, season, episode }) {
  if (type === 'tv') {
    return `/embed/tv/${id}/${season ?? 1}/${episode ?? 1}`
  }
  return `/embed/movie/${id}`
}

export function buildRouterStateTree({ id, type, season, episode }) {
  if (type === 'tv') {
    return encodeURIComponent(
      JSON.stringify([
        '',
        {
          children: [
            'embed',
            {
              children: [
                ['type', 'show', 'd'],
                {
                  children: [
                    ['id', String(id), 'd'],
                    {
                      children: [
                        ['season', String(season ?? 1), 'd'],
                        {
                          children: [
                            ['episode', String(episode ?? 1), 'd'],
                            { children: ['__PAGE__', {}, null, null] },
                            null,
                            null,
                          ],
                        },
                        null,
                        null,
                      ],
                    },
                    null,
                    null,
                  ],
                },
                null,
                null,
              ],
            },
            null,
            null,
          ],
        },
        null,
        null,
        true,
      ]),
    )
  }

  return encodeURIComponent(
    JSON.stringify([
      '',
      {
        children: [
          'embed',
          {
            children: [
              ['type', 'movie', 'd'],
              {
                children: [
                  ['id', String(id), 'd'],
                  { children: ['__PAGE__', {}, null, null] },
                  null,
                  null,
                ],
              },
              null,
              null,
            ],
          },
          null,
          null,
        ],
      },
      null,
      null,
      true,
    ]),
  )
}

export function undefinedArg(value) {
  return value == null ? '$undefined' : value
}

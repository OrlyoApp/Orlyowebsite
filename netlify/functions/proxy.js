exports.handler = async (event) => {
  const { service, body, path, params } = JSON.parse(event.body)
  let url, reqHeaders, method = 'GET', reqBody

  if (service === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    }
    method = 'POST'
    reqBody = body
  } else if (service === 'supabase') {
    url = `https://ykppmjocbrnkokeeiubd.supabase.co/rest/v1/${path}${params || ''}`
    reqHeaders = {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'count=exact'
    }
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown service' }) }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: reqBody
    })
    const data = await response.json()
    const contentRange = response.headers.get('content-range')
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'x-content-range': contentRange || ''
      },
      body: JSON.stringify(data)
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}

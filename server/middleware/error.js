export const notFound = (req, res) => {
  res.status(404).json({ message: `接口不存在：${req.method} ${req.originalUrl}` })
}

export const errorHandler = (error, _req, res, _next) => {
  const status = Number(error.status) || 500

  if (status >= 500) {
    console.error('[HireFlow API]', error)
  }

  res.status(status).json({
    message: error.message || '服务器内部错误'
  })
}

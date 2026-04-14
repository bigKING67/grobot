fn success(id: Value, result: Value) -> RpcSuccessResponse {
    RpcSuccessResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
    }
}

fn error(id: Value, code: i64, message: &str) -> RpcErrorResponse {
    RpcErrorResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: RpcErrorObject {
            code,
            message: message.to_string(),
            data: None,
        },
    }
}

fn error_with_data(id: Value, code: i64, message: &str, data: Value) -> RpcErrorResponse {
    RpcErrorResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: RpcErrorObject {
            code,
            message: message.to_string(),
            data: Some(data),
        },
    }
}
